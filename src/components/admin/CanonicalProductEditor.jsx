import { Box, Button, HStack, Input, NativeSelect, SimpleGrid, Text, Textarea, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiRefreshCw, FiSave } from "react-icons/fi";

import { EmptyState, ErrorState, LoadingState } from "../StatusState";
import { useApiTrace } from "../ApiTraceContext";
import {
  approveCatalogImageJob,
  createAdminCatalogBrand,
  createIdempotencyKey,
  getAdminCatalogProductV2,
  getAdminCatalogProductV3,
  getAdminCatalogProductPreviewV3,
  getAdminCatalogProductReadinessV3,
  getCatalogImageJob,
  saveAdminCatalogProductDraftV2,
  saveAdminCatalogProductDraftV3,
  startAdminCatalogProductRevisionV2,
  startAdminCatalogProductRevisionV3,
  startCatalogWorkflow,
  submitCatalogMediaCommand,
} from "../../utils/apiClient";
import BrandSelect from "./BrandSelect";
import ProductInventoryEditor from "./ProductInventoryEditor";
import ProductContentEditor from "./ProductContentEditor";
import ProductDraftPreview from "./ProductDraftPreview";
import ProductLifecycleActions from "./ProductLifecycleActions";
import ProductMediaEditor from "./ProductMediaEditor";
import ProductReadinessPanel from "./ProductReadinessPanel";

const emptyReferences = { brands: [], stores: [], categories: [], availability: [] };

const blankInventory = () => ({
  store_id: "",
  size: null,
  availability: "in stock",
  inventory_qty: 0,
  metadata: {},
});

function editableProduct(detail, schemaVersion = 2) {
  const snapshot = detail?.current_draft?.product || detail?.published_snapshot;
  if (snapshot) return structuredClone(snapshot);
  return {
    schema_version: schemaVersion,
    product_id: detail?.product_id || null,
    seed_run_id: "catalog_studio",
    title: detail?.title || "",
    description: detail?.description || "",
    brand_id: "",
    brand: detail?.brand || "",
    category: detail?.category || "",
    price_min: 0,
    price_max: 0,
    link: null,
    color: null,
    material: null,
    gender: null,
    season: null,
    metadata: detail?.metadata || {},
    media: [],
    inventory: [blankInventory()],
    ...(schemaVersion >= 3 ? {
      benefits: [],
      specifications: [],
      care_instructions: [],
      content_details: [],
      seo: { title: null, description: null, keywords: [] },
      source_references: [],
      readiness_inputs: { required_specifications: [] },
    } : {}),
  };
}

function normalizedPayload(product, schemaVersion = 2) {
  const optional = (value) => String(value || "").trim() || null;
  const normalized = {
    ...product,
    schema_version: schemaVersion,
    link: optional(product.link),
    color: optional(product.color),
    material: optional(product.material),
    gender: optional(product.gender),
    season: optional(product.season),
    price_min: Number(product.price_min),
    price_max: Number(product.price_max),
    inventory: product.inventory.map((row) => ({
      ...row,
      size: optional(row.size),
      inventory_qty: Number(row.inventory_qty),
      metadata: row.metadata || {},
    })),
  };
  if (schemaVersion >= 3) {
    normalized.benefits = (product.benefits || []).map((value) => String(value).trim()).filter(Boolean);
    normalized.specifications = (product.specifications || [])
      .map((item) => ({ name: String(item.name || "").trim(), value: String(item.value || "").trim() }))
      .filter((item) => item.name || item.value);
    normalized.care_instructions = (product.care_instructions || []).map((value) => String(value).trim()).filter(Boolean);
    normalized.content_details = (product.content_details || []).map((value) => String(value).trim()).filter(Boolean);
    normalized.seo = {
      title: optional(product.seo?.title),
      description: optional(product.seo?.description),
      keywords: (product.seo?.keywords || []).map((value) => String(value).trim()).filter(Boolean),
    };
    normalized.source_references = product.source_references || [];
    normalized.readiness_inputs = {
      required_specifications: (product.readiness_inputs?.required_specifications || []).map((value) => String(value).trim()).filter(Boolean),
    };
    normalized.media = (product.media || []).map((item) => ({ ...item, alt_text: optional(item.alt_text) }));
  }
  return normalized;
}

function comparisonSnapshot(product, schemaVersion = 2) {
  return JSON.stringify(normalizedPayload(product, schemaVersion));
}

function validate(product, references, referencesReady) {
  const errors = {};
  ["title", "description", "brand_id", "brand", "category"].forEach((field) => {
    if (!String(product[field] || "").trim()) errors[field === "brand_id" ? "brand" : field] = "Required";
  });
  const minimum = Number(product.price_min);
  const maximum = Number(product.price_max);
  if (!Number.isFinite(minimum) || minimum < 0) errors.price_min = "Enter a non-negative price.";
  if (!Number.isFinite(maximum) || maximum < 0) errors.price_max = "Enter a non-negative price.";
  if (Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > maximum) {
    errors.price_max = "Maximum price must be at least the minimum price.";
  }
  if (referencesReady) {
    const brand = references.brands.find((item) => item.id === product.brand_id);
    if (!brand || brand.name !== product.brand) errors.brand = "Select an active canonical brand.";
    if (!references.categories.some((item) => item.id === product.category)) errors.category = "Select a catalog category.";
  }
  if (!product.inventory.length) errors.inventory = "At least one inventory row is required.";
  const inventoryKeys = new Set();
  product.inventory.forEach((row, index) => {
    if (!String(row.store_id || "").trim()) errors[`inventory.${index}.store_id`] = "Store is required.";
    if (!String(row.availability || "").trim()) errors[`inventory.${index}.availability`] = "Availability is required.";
    const quantity = Number(row.inventory_qty);
    if (!Number.isInteger(quantity) || quantity < 0) errors[`inventory.${index}.inventory_qty`] = "Quantity must be a non-negative integer.";
    if (referencesReady && row.store_id && !references.stores.some((store) => store.id === row.store_id)) {
      errors[`inventory.${index}.store_id`] = "Select an active store.";
    }
    if (referencesReady && row.availability && !references.availability.some((item) => item.id === row.availability)) {
      errors[`inventory.${index}.availability`] = "Select an availability value.";
    }
    const key = `${String(row.store_id || "").trim().toLocaleLowerCase()}::${String(row.size || "").trim().toLocaleLowerCase().replace(/\s+/g, " ")}`;
    if (inventoryKeys.has(key)) errors[`inventory.${index}.store_id`] = "This store and size combination is already listed.";
    inventoryKeys.add(key);
  });
  return errors;
}

function serverValidationErrors(error) {
  const detail = error?.response?.data?.detail;
  if (!Array.isArray(detail)) return { messages: [], fields: {} };
  const fields = {};
  const messages = detail.map((item) => {
    const parts = (item.loc || []).filter((part) => part !== "body");
    const productParts = parts[0] === "product" ? parts.slice(1) : parts;
    let key = productParts.join(".");
    if (["brand", "brand_id"].includes(productParts[0])) key = "brand";
    if (productParts[0] === "inventory" && Number.isInteger(productParts[1])) {
      key = `inventory.${productParts[1]}.${productParts[2] || "store_id"}`;
    }
    if (key) fields[key] = item.msg || "Invalid value";
    const location = parts.join(" → ");
    return `${location || "Request"}: ${item.msg || "Invalid value"}`;
  });
  return { messages, fields };
}

function FieldError({ message }) {
  return message ? <Text className="field-error">{message}</Text> : null;
}

export default function CanonicalProductEditor({
  productId,
  refreshKey = 0,
  onDirtyChange,
  onCatalogChanged,
  onLifecycleChanged,
  references: providedReferences = emptyReferences,
  referencesStatus = "loading",
  referencesError,
  onRetryReferences,
  onBrandAdded,
  onDetailChange,
  authoringSchemaVersion = 2,
}) {
  const schemaVersion = Number(authoringSchemaVersion) >= 3 ? 3 : 2;
  const references = providedReferences || emptyReferences;
  const [detail, setDetail] = useState(null);
  const [product, setProduct] = useState(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(Boolean(productId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverErrors, setServerErrors] = useState([]);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [mediaJob, setMediaJob] = useState(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [preview, setPreview] = useState(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [projectionError, setProjectionError] = useState("");
  const { startAction } = useApiTrace();
  const saveInFlight = useRef(false);
  const idempotencyKeys = useRef({});

  const mutationKey = (scope, payload) => {
    const signature = JSON.stringify(payload);
    const current = idempotencyKeys.current[scope];
    if (current?.signature === signature) return current.key;
    const key = createIdempotencyKey(scope);
    idempotencyKeys.current[scope] = { signature, key };
    return key;
  };

  const applyDetail = useCallback((nextDetail) => {
    const nextProduct = editableProduct(nextDetail, schemaVersion);
    setDetail(nextDetail);
    setProduct(nextProduct);
    setBaseline(comparisonSnapshot(nextProduct, schemaVersion));
    setErrors({});
    setServerErrors([]);
    setConflict(false);
    setError(null);
    onDetailChange?.(nextDetail);
  }, [onDetailChange, schemaVersion]);

  const load = useCallback(async () => {
    if (!productId) return null;
    setLoading(true);
    setError(null);
    setNotice("");
    try {
      const getProduct = schemaVersion >= 3 ? getAdminCatalogProductV3 : getAdminCatalogProductV2;
      const nextDetail = await getProduct(productId);
      applyDetail(nextDetail);
      return nextDetail;
    } catch (nextError) {
      setError(nextError);
      return null;
    } finally {
      setLoading(false);
    }
  }, [applyDetail, productId, schemaVersion]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const loadProjection = useCallback(async () => {
    const draftId = detail?.current_draft?.revision?.id;
    if (schemaVersion < 3 || !detail?.product_id || !draftId) {
      setReadiness(null);
      setPreview(null);
      setProjectionError("");
      return;
    }
    setProjectionLoading(true);
    setProjectionError("");
    try {
      const [nextReadiness, nextPreview] = await Promise.all([
        getAdminCatalogProductReadinessV3(detail.product_id, draftId),
        getAdminCatalogProductPreviewV3(detail.product_id, draftId),
      ]);
      setReadiness(nextReadiness);
      setPreview(nextPreview);
    } catch {
      setProjectionError("Readiness and preview could not be loaded. Your draft remains available.");
    } finally {
      setProjectionLoading(false);
    }
  }, [detail?.current_draft?.revision?.id, detail?.product_id, schemaVersion]);

  useEffect(() => { void loadProjection(); }, [loadProjection]);

  const dirty = useMemo(() => Boolean(product && baseline && comparisonSnapshot(product, schemaVersion) !== baseline), [baseline, product, schemaVersion]);
  const mediaCandidateActive = Boolean(mediaJob && ["queued", "running", "succeeded"].includes(mediaJob.status));
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const updateProduct = (field) => (event) => {
    setProduct((current) => ({ ...current, [field]: event.target.value }));
    setNotice("");
  };
  const updateContent = (nextProduct) => { setProduct(nextProduct); setNotice(""); };
  const updateMedia = (media) => { setProduct((current) => ({ ...current, media })); setNotice(""); };
  const updateInventory = (inventory) => { setProduct((current) => ({ ...current, inventory })); setNotice(""); };

  const save = async () => {
    if (saveInFlight.current) return;
    const referencesReady = referencesStatus === "ready";
    const nextErrors = validate(product, references, referencesReady);
    setErrors(nextErrors);
    setServerErrors([]);
    setConflict(false);
    setNotice("");
    setError(null);
    if (Object.keys(nextErrors).length) return;

    saveInFlight.current = true;
    setSaving(true);
    const traceAction = startAction("Save catalog product draft", {
      surface: "catalog-studio",
      attributes: {
        action: "product_draft_save",
        draft_id: detail.current_draft?.revision?.id || "",
        product_id: detail.product_id,
      },
    });
    try {
      let currentDraft = detail.current_draft;
      if (!currentDraft) {
        const revisionPayload = { expected_version: detail.version };
        const startRevision = schemaVersion >= 3 ? startAdminCatalogProductRevisionV3 : startAdminCatalogProductRevisionV2;
        currentDraft = await startRevision(detail.product_id, revisionPayload, mutationKey(`start-v${schemaVersion}-revision`, revisionPayload));
        setDetail((current) => ({ ...current, current_draft: currentDraft }));
        delete idempotencyKeys.current[`start-v${schemaVersion}-revision`];
      }
      const draftPayload = {
        expected_version: detail.version,
        current_draft_id: currentDraft.revision.id,
        expected_draft_version: currentDraft.draft_version,
        moderation_state: currentDraft.revision.moderation_state || "approved",
        product: normalizedPayload(product, schemaVersion),
      };
      const saveDraft = schemaVersion >= 3 ? saveAdminCatalogProductDraftV3 : saveAdminCatalogProductDraftV2;
      await saveDraft(detail.product_id, draftPayload, mutationKey(`save-v${schemaVersion}-draft`, draftPayload));
      delete idempotencyKeys.current[`save-v${schemaVersion}-draft`];
      const getProduct = schemaVersion >= 3 ? getAdminCatalogProductV3 : getAdminCatalogProductV2;
      const nextDetail = await getProduct(detail.product_id);
      applyDetail(nextDetail);
      setNotice("Draft saved. The published catalog remains unchanged until publication.");
      onCatalogChanged?.(nextDetail);
      traceAction.end("completed", {
        draft_id: nextDetail.current_draft?.revision?.id || currentDraft.revision.id,
        product_id: detail.product_id,
      });
    } catch (nextError) {
      if (nextError?.response?.status === 409) setConflict(true);
      else if (nextError?.response?.status === 422) {
        const validation = serverValidationErrors(nextError);
        setServerErrors(validation.messages);
        setErrors((current) => ({ ...current, ...validation.fields }));
      } else setError(nextError);
      traceAction.end("failed", {
        error_code: nextError?.response?.status || nextError?.code || nextError?.name || "draft_save_error",
        draft_id: detail.current_draft?.revision?.id || "",
        product_id: detail.product_id,
      });
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const lifecycleChanged = async (action) => {
    const nextDetail = await load();
    setNotice(action === "published" ? "Product published successfully." : "Product archived successfully.");
    onCatalogChanged?.(nextDetail);
    onLifecycleChanged?.(action, nextDetail);
  };

  const generateMedia = async (command) => {
    if (dirty) { setNotice("Save the draft before generating an image variant."); return; }
    const currentDraft = detail.current_draft;
    if (!currentDraft) { setNotice("Start and save a private draft before generating an image variant."); return; }
    setMediaBusy(true);
    setNotice("");
    const traceAction = startAction("Generate catalog image variant", {
      surface: "catalog-studio",
      attributes: {
        action: "media_generate",
        draft_id: currentDraft.revision.id,
        product_id: detail.product_id,
        workflow_id: currentDraft.workflow_id || "",
      },
    });
    try {
      let workflowId = currentDraft.workflow_id;
      if (!workflowId) {
        const workflow = await startCatalogWorkflow({
          title: `Image variants for ${product.title}`,
          business_summary: "Create reviewed product imagery without changing price or inventory.",
          draft_id: currentDraft.revision.id,
        }, createIdempotencyKey("media-workflow"));
        workflowId = workflow.id;
      }
      let job = await submitCatalogMediaCommand(workflowId, {
        draft_id: currentDraft.revision.id,
        expected_draft_version: currentDraft.draft_version,
        ...command,
      }, createIdempotencyKey("media-variant"));
      setMediaJob(job);
      for (let attempt = 0; attempt < 60 && ["queued", "running"].includes(job.status); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, Math.min(500 * (attempt + 1), 2000)));
        job = await getCatalogImageJob(workflowId, job.id);
        setMediaJob(job);
      }
      if (job.status === "failed") setNotice("The image variant failed. Product details and inventory are unchanged.");
      if (["queued", "running"].includes(job.status)) setNotice("The image variant is still processing. Refresh the product to check its status.");
      traceAction.end(job.status === "failed" ? "failed" : "completed", {
        draft_id: currentDraft.revision.id,
        job_id: job.id,
        product_id: detail.product_id,
        workflow_id: workflowId,
      });
    } catch (error) {
      setNotice("The image variant could not be created. Product details and inventory are unchanged.");
      traceAction.end("failed", {
        error_code: error?.response?.status || error?.code || error?.name || "media_generate_error",
        draft_id: currentDraft.revision.id,
        product_id: detail.product_id,
        workflow_id: currentDraft.workflow_id || "",
      });
    } finally {
      setMediaBusy(false);
    }
  };

  const approveMedia = async (approval = {}) => {
    if (!mediaJob || !detail.current_draft) return;
    const localProduct = product;
    const preserveLocalEdits = dirty;
    setMediaBusy(true);
    const traceAction = startAction("Approve catalog image variant", {
      surface: "catalog-studio",
      attributes: {
        action: "media_approve",
        draft_id: detail.current_draft.revision.id,
        job_id: mediaJob.id,
        product_id: detail.product_id,
        workflow_id: mediaJob.workflow_id || "",
      },
    });
    try {
      await approveCatalogImageJob(mediaJob.workflow_id, mediaJob.id, {
        draft_id: detail.current_draft.revision.id,
        expected_draft_version: detail.current_draft.draft_version,
        ...approval,
      }, createIdempotencyKey("approve-media"));
      const getProduct = schemaVersion >= 3 ? getAdminCatalogProductV3 : getAdminCatalogProductV2;
      const nextDetail = await getProduct(detail.product_id);
      setMediaJob(null);
      if (preserveLocalEdits) {
        const serverProduct = editableProduct(nextDetail, schemaVersion);
        setDetail(nextDetail);
        setProduct({ ...localProduct, media: serverProduct.media });
        setBaseline(comparisonSnapshot(serverProduct, schemaVersion));
        setErrors({});
        setServerErrors([]);
        setConflict(false);
        setError(null);
      } else {
        applyDetail(nextDetail);
      }
      setNotice(approval.approval_intent === "replace" ? "Replacement approved for the next publication." : "Image variant added to the next publication.");
      traceAction.end("completed", {
        draft_id: detail.current_draft.revision.id,
        job_id: mediaJob.id,
        product_id: detail.product_id,
        workflow_id: mediaJob.workflow_id || "",
      });
    } catch (error) {
      setNotice("The image variant could not be approved. Try again with the current draft.");
      traceAction.end("failed", {
        error_code: error?.response?.status || error?.code || error?.name || "media_approve_error",
        draft_id: detail.current_draft.revision.id,
        job_id: mediaJob.id,
        product_id: detail.product_id,
        workflow_id: mediaJob.workflow_id || "",
      });
    } finally {
      setMediaBusy(false);
    }
  };

  const createBrand = async (name) => {
    const brand = await createAdminCatalogBrand({ name }, createIdempotencyKey("create-brand"));
    onBrandAdded?.(brand);
    return brand;
  };

  if (!productId) return <EmptyState title="Select a product" message="Choose a catalog product to inspect and edit." />;
  if (loading) return <LoadingState label="Loading product editor" />;
  if (error && !product) return <ErrorState title="Product unavailable" onRetry={load} />;
  if (!detail || !product) return null;

  const referencesReady = referencesStatus === "ready";
  const categoryExists = references.categories.some((item) => item.id === product.category);
  return (
    <VStack align="stretch" gap={6} className="product-editor merchandiser-product-editor">
      <HStack justify="space-between" gap={4} align="start" flexWrap="wrap">
        <Box>
          <Text className="section-kicker">Merchandiser editor</Text>
          <Text as="h2" className="studio-column-title">{detail.title}</Text>
          <Text className="muted-text">Manage the product shoppers see, its imagery, and store availability.</Text>
        </Box>
        <HStack gap={2} flexWrap="wrap">
          <Button type="button" className="secondary-button" disabled={!dirty || saving} onClick={() => applyDetail(detail)}>Discard edits</Button>
          <Button type="button" className="primary-button" disabled={!dirty || saving || mediaCandidateActive} onClick={save}><FiSave /> {saving ? "Saving…" : "Save draft"}</Button>
        </HStack>
      </HStack>

      {conflict ? (
        <Box className="catalog-conflict-alert" role="alert">
          <Text className="panel-title">A newer server revision exists</Text>
          <Text>Your local edits are preserved. Reload only when you are ready to replace them with the current server version.</Text>
          <Button type="button" className="secondary-button" mt={3} onClick={load}><FiRefreshCw /> Reload server version</Button>
        </Box>
      ) : null}
      {serverErrors.length ? <Box className="catalog-validation-summary" role="alert"><Text className="panel-title">The server rejected these fields</Text>{serverErrors.map((message) => <Text key={message}>{message}</Text>)}</Box> : null}
      {error && product ? <Text className="error-copy">The draft could not be saved. Your local edits are still available.</Text> : null}
      {notice ? <Text className="notice-text" aria-live="polite">{notice}</Text> : null}
      {dirty && mediaCandidateActive ? <Text className="catalog-action-hint">Your edits are preserved. Finish the active image candidate before saving the draft.</Text> : null}

      <Box className="catalog-editor-guidance">
        <Text className="panel-title">Draft first, then publish</Text>
        <Text className="muted-text">Changes remain private until publication. Archive removes the product from shopping surfaces while retaining its history.</Text>
      </Box>

      <Box className="editor-section merchandiser-product-details">
        <Text className="panel-title" mb={1}>Product details</Text>
        <Text className="muted-text" mb={4}>Edit the customer-facing facts that define this product.</Text>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
          <Box><Text className="filter-label">Title</Text><Input aria-label="Product title" value={product.title} onChange={updateProduct("title")} /><FieldError message={errors.title} /></Box>
          <Box><Text className="filter-label">Brand</Text><BrandSelect brandId={product.brand_id} brandName={product.brand} brands={references.brands} status={referencesStatus} error={errors.brand || referencesError} onChange={(brand) => setProduct((current) => ({ ...current, brand_id: brand.id, brand: brand.name }))} onCreate={createBrand} onRetry={onRetryReferences} /></Box>
          <Box>
            <Text className="filter-label">Category</Text>
            <NativeSelect.Root><NativeSelect.Field aria-label="Product category" value={product.category} onChange={updateProduct("category")} disabled={!referencesReady} className="native-select">{product.category && !categoryExists ? <option value={product.category}>{product.category}</option> : null}{!product.category ? <option value="">Select a category</option> : null}{references.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect.Field><NativeSelect.Indicator /></NativeSelect.Root>
            <FieldError message={errors.category} />
          </Box>
          <Box><Text className="filter-label">Product link</Text><Input aria-label="Product link" value={product.link || ""} onChange={updateProduct("link")} /></Box>
          <Box><Text className="filter-label">Minimum price</Text><Input aria-label="Minimum price" type="number" min="0" step="0.01" value={product.price_min} onChange={updateProduct("price_min")} /><FieldError message={errors.price_min} /></Box>
          <Box><Text className="filter-label">Maximum price</Text><Input aria-label="Maximum price" type="number" min="0" step="0.01" value={product.price_max} onChange={updateProduct("price_max")} /><FieldError message={errors.price_max} /></Box>
        </SimpleGrid>
        {schemaVersion < 3 ? <Box mt={4}><Text className="filter-label">Description</Text><Textarea aria-label="Product description" value={product.description} onChange={updateProduct("description")} rows={4} /><FieldError message={errors.description} /></Box> : null}
        <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap={3} mt={4}>
          {["color", "material", "gender", "season"].map((field) => <Box key={field}><Text className="filter-label">{field}</Text><Input aria-label={`Product ${field}`} value={product[field] || ""} onChange={updateProduct(field)} /></Box>)}
        </SimpleGrid>
      </Box>

      {schemaVersion >= 3 ? (
        <ProductContentEditor
          product={product}
          onChange={updateContent}
        />
      ) : null}
      <ProductMediaEditor
        media={product.media || []}
        busy={mediaBusy}
        job={mediaJob}
        mutationsDisabled={mediaCandidateActive}
        onChange={updateMedia}
        onGenerate={generateMedia}
        onApprove={approveMedia}
        enableAltText={schemaVersion >= 3}
      />
      <ProductInventoryEditor inventory={product.inventory || []} stores={references.stores} availability={references.availability} referencesReady={referencesReady} errors={errors} onChange={updateInventory} />
      <FieldError message={errors.inventory} />
      {schemaVersion >= 3 && detail.current_draft ? (
        <>
          <ProductDraftPreview payload={preview} loading={projectionLoading} error={projectionError} dirty={dirty} onRetry={loadProjection} />
          <ProductReadinessPanel readiness={readiness} loading={projectionLoading} error={projectionError} dirty={dirty} onRetry={loadProjection} />
        </>
      ) : null}
      <ProductLifecycleActions product={detail} dirty={dirty} authoringSchemaVersion={schemaVersion} readiness={readiness} onChanged={lifecycleChanged} />
    </VStack>
  );
}
