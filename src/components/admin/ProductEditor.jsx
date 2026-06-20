import { Badge, Box, Button, HStack, Input, SimpleGrid, Text, Textarea, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiPlus, FiRefreshCw, FiSave, FiTrash2 } from "react-icons/fi";

import { EmptyState, ErrorState, LoadingState } from "../StatusState";
import { useApiTrace } from "../ApiTraceContext";
import {
  createIdempotencyKey,
  approveCatalogImageJob,
  getAdminCatalogProduct,
  getCatalogImageJob,
  saveAdminCatalogProductDraft,
  startCatalogWorkflow,
  startAdminCatalogProductRevision,
  submitCatalogMediaCommand,
} from "../../utils/apiClient";
import ProductMediaEditor from "./ProductMediaEditor";
import ProductLifecycleActions from "./ProductLifecycleActions";
import CanonicalProductEditor from "./CanonicalProductEditor";

const blankInventory = () => ({
  store_id: "",
  size: "One Size",
  availability: "in stock",
  inventory_qty: 0,
  objective_weight: 0,
  metadata: {},
});

const blankVariant = () => ({
  variant_id: null,
  color: "",
  material: "",
  gender: "",
  season: "",
  price_min: 0,
  price_max: 0,
  link: "",
  image_link: "",
  image_set: {},
  metadata: {},
  inventory: [blankInventory()],
});

function editableProduct(detail) {
  const snapshot = detail?.current_draft?.product || detail?.published_snapshot;
  if (snapshot) return structuredClone(snapshot);
  return {
    product_id: detail?.product_id || null,
    seed_run_id: "catalog_studio",
    title: detail?.title || "",
    description: detail?.description || "",
    brand: detail?.brand || "",
    category: detail?.category || "",
    metadata: detail?.metadata || {},
    design_specification: null,
    variant_axes: [],
    primary_variant_index: 0,
    media: [],
    variants: [blankVariant()],
  };
}

function normalizedPayload(product, metadataText) {
  return {
    ...product,
    metadata: JSON.parse(metadataText || "{}"),
    variants: product.variants.map((variant) => ({
      ...variant,
      color: variant.color || null,
      material: variant.material || null,
      gender: variant.gender || null,
      season: variant.season || null,
      link: variant.link || null,
      image_link: variant.image_link || null,
      price_min: Number(variant.price_min),
      price_max: Number(variant.price_max),
      inventory: variant.inventory.map((row) => ({
        ...row,
        inventory_qty: Number(row.inventory_qty),
        objective_weight: Number(row.objective_weight || 0),
      })),
    })),
  };
}

function comparisonSnapshot(product, metadataText) {
  return JSON.stringify({
    product: {
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        price_min: Number(variant.price_min),
        price_max: Number(variant.price_max),
        inventory: variant.inventory.map((row) => ({
          ...row,
          inventory_qty: Number(row.inventory_qty),
          objective_weight: Number(row.objective_weight || 0),
        })),
      })),
    },
    metadataText,
  });
}

function validate(product, metadataText) {
  const errors = {};
  ["title", "description", "brand", "category", "seed_run_id"].forEach((field) => {
    if (!String(product[field] || "").trim()) errors[field] = "Required";
  });
  try {
    JSON.parse(metadataText || "{}");
  } catch {
    errors.metadata = "Metadata must be valid JSON.";
  }
  if (!product.variants.length) errors.variants = "At least one variant is required.";
  product.variants.forEach((variant, variantIndex) => {
    const min = Number(variant.price_min);
    const max = Number(variant.price_max);
    if (!Number.isFinite(min) || min < 0) errors[`variant.${variantIndex}.price_min`] = "Enter a non-negative price.";
    if (!Number.isFinite(max) || max < 0) errors[`variant.${variantIndex}.price_max`] = "Enter a non-negative price.";
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
      errors[`variant.${variantIndex}.price_max`] = "Maximum price must be at least the minimum price.";
    }
    if (!variant.inventory.length) errors[`variant.${variantIndex}.inventory`] = "At least one inventory row is required.";
    variant.inventory.forEach((row, inventoryIndex) => {
      if (!String(row.store_id || "").trim()) errors[`inventory.${variantIndex}.${inventoryIndex}.store_id`] = "Store is required.";
      if (!String(row.availability || "").trim()) errors[`inventory.${variantIndex}.${inventoryIndex}.availability`] = "Availability is required.";
      const quantity = Number(row.inventory_qty);
      if (!Number.isInteger(quantity) || quantity < 0) errors[`inventory.${variantIndex}.${inventoryIndex}.inventory_qty`] = "Quantity must be a non-negative integer.";
      const weight = Number(row.objective_weight || 0);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) errors[`inventory.${variantIndex}.${inventoryIndex}.objective_weight`] = "Weight must be between 0 and 1.";
    });
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
    let fieldKey = productParts.join(".");
    if (productParts[0] === "variants" && Number.isInteger(productParts[1])) {
      fieldKey = productParts[2] === "inventory"
        ? `inventory.${productParts[1]}.${productParts[3]}.${productParts[4]}`
        : `variant.${productParts[1]}.${productParts[2]}`;
    }
    if (fieldKey) fields[fieldKey] = item.msg || "Invalid value";
    const location = (item.loc || []).filter((part) => part !== "body").join(" → ");
    return `${location || "Request"}: ${item.msg || "Invalid value"}`;
  });
  return { messages, fields };
}

function FieldError({ message }) {
  return message ? <Text className="field-error">{message}</Text> : null;
}

function variantImageUrl(variant) {
  return variant.image_link
    || variant.image_set?.primary_url
    || variant.image_set?.thumbnail_url
    || variant.image_set?.detail_urls?.[0]
    || "";
}

export function CompatibilityProductEditor({ productId, refreshKey = 0, onDirtyChange, onCatalogChanged, onLifecycleChanged, onDetailChange }) {
  const [detail, setDetail] = useState(null);
  const [product, setProduct] = useState(null);
  const [metadataText, setMetadataText] = useState("{}");
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
    const nextProduct = editableProduct(nextDetail);
    const nextMetadata = JSON.stringify(nextProduct.metadata || {}, null, 2);
    setDetail(nextDetail);
    setProduct(nextProduct);
    setMetadataText(nextMetadata);
    setBaseline(comparisonSnapshot(nextProduct, nextMetadata));
    setErrors({});
    setServerErrors([]);
    setConflict(false);
    setError(null);
    onDetailChange?.(nextDetail);
  }, [onDetailChange]);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    setNotice("");
    try {
      const nextDetail = await getAdminCatalogProduct(productId);
      applyDetail(nextDetail);
      return nextDetail;
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
    return null;
  }, [applyDetail, productId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const dirty = useMemo(() => {
    if (!product || !baseline) return false;
    return comparisonSnapshot(product, metadataText) !== baseline;
  }, [baseline, metadataText, product]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const updateProduct = (field) => (event) => {
    setProduct((current) => ({ ...current, [field]: event.target.value }));
    setNotice("");
  };

  const updateMedia = (media) => {
    setProduct((current) => ({ ...current, media }));
    setNotice("");
  };

  const updateVariant = (variantIndex, field) => (event) => {
    const value = event.target.value;
    setProduct((current) => ({
      ...current,
      variants: current.variants.map((variant, index) => (
        index === variantIndex
          ? { ...variant, [field]: value, ...(field === "image_link" ? { image_set: {} } : {}) }
          : variant
      )),
    }));
    setNotice("");
  };

  const updateInventory = (variantIndex, inventoryIndex, field) => (event) => {
    setProduct((current) => ({
      ...current,
      variants: current.variants.map((variant, index) => (
        index === variantIndex
          ? {
              ...variant,
              inventory: variant.inventory.map((row, rowIndex) => (
                rowIndex === inventoryIndex ? { ...row, [field]: event.target.value } : row
              )),
            }
          : variant
      )),
    }));
    setNotice("");
  };

  const addVariant = () => setProduct((current) => ({ ...current, variants: [...current.variants, blankVariant()] }));
  const removeVariant = (variantIndex) => setProduct((current) => ({
    ...current,
    variants: current.variants.filter((_, index) => index !== variantIndex),
  }));
  const addInventory = (variantIndex) => setProduct((current) => ({
    ...current,
    variants: current.variants.map((variant, index) => (
      index === variantIndex ? { ...variant, inventory: [...variant.inventory, blankInventory()] } : variant
    )),
  }));
  const removeInventory = (variantIndex, inventoryIndex) => setProduct((current) => ({
    ...current,
    variants: current.variants.map((variant, index) => (
      index === variantIndex
        ? { ...variant, inventory: variant.inventory.filter((_, rowIndex) => rowIndex !== inventoryIndex) }
        : variant
    )),
  }));

  const save = async () => {
    if (saveInFlight.current) return;
    const nextErrors = validate(product, metadataText);
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
        currentDraft = await startAdminCatalogProductRevision(
          detail.product_id,
          revisionPayload,
          mutationKey("start-revision", revisionPayload),
        );
        setDetail((current) => ({ ...current, current_draft: currentDraft }));
        delete idempotencyKeys.current["start-revision"];
      }
      const draftPayload = {
        expected_version: detail.version,
        current_draft_id: currentDraft.revision.id,
        expected_draft_version: currentDraft.draft_version,
        moderation_state: currentDraft.revision.moderation_state || "approved",
        product: normalizedPayload(product, metadataText),
      };
      await saveAdminCatalogProductDraft(
        detail.product_id,
        draftPayload,
        mutationKey("save-draft", draftPayload),
      );
      delete idempotencyKeys.current["save-draft"];
      const nextDetail = await getAdminCatalogProduct(detail.product_id);
      applyDetail(nextDetail);
      setNotice("Draft saved. The published catalog remains unchanged until publication.");
      onCatalogChanged?.(nextDetail);
      traceAction.end("completed", {
        draft_id: nextDetail.current_draft?.revision?.id || currentDraft.revision.id,
        product_id: detail.product_id,
      });
    } catch (nextError) {
      if (nextError?.response?.status === 409) {
        setConflict(true);
      } else if (nextError?.response?.status === 422) {
        const validation = serverValidationErrors(nextError);
        setServerErrors(validation.messages);
        setErrors((current) => ({ ...current, ...validation.fields }));
      } else {
        setError(nextError);
      }
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
    if (dirty) {
      setNotice("Save the draft before generating a media variation.");
      return;
    }
    const currentDraft = detail.current_draft;
    if (!currentDraft) {
      setNotice("Start and save a private draft before generating media.");
      return;
    }
    setMediaBusy(true);
    setNotice("");
    const traceAction = startAction("Generate catalog media variation", {
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
          title: `Media variations for ${product.title}`,
          business_summary: "Create reviewed product media without changing sellable inventory.",
          draft_id: currentDraft.revision.id,
        }, createIdempotencyKey("media-workflow"));
        workflowId = workflow.id;
      }
      let job = await submitCatalogMediaCommand(workflowId, {
        draft_id: currentDraft.revision.id,
        expected_draft_version: currentDraft.draft_version,
        ...command,
      }, createIdempotencyKey("media-variation"));
      setMediaJob(job);
      for (let attempt = 0; attempt < 60 && ["queued", "running"].includes(job.status); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, Math.min(500 * (attempt + 1), 2000)));
        job = await getCatalogImageJob(workflowId, job.id);
        setMediaJob(job);
      }
      await load();
      if (job.status === "failed") setNotice("The media variation failed. The product draft and inventory are unchanged.");
      if (["queued", "running"].includes(job.status)) setNotice("The media variation is still processing. Refresh the product to check its status.");
      traceAction.end(job.status === "failed" ? "failed" : "completed", {
        draft_id: currentDraft.revision.id,
        job_id: job.id,
        product_id: detail.product_id,
        workflow_id: workflowId,
      });
    } catch (error) {
      setNotice("The media variation could not be created. The product draft and inventory are unchanged.");
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
    setMediaBusy(true);
    const traceAction = startAction("Approve catalog media variation", {
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
      await approveCatalogImageJob(
        mediaJob.workflow_id,
        mediaJob.id,
        {
          draft_id: detail.current_draft.revision.id,
          expected_draft_version: detail.current_draft.draft_version,
          ...approval,
        },
        createIdempotencyKey("approve-media"),
      );
      setMediaJob(null);
      await load();
      setNotice("Media variation approved for the next publication.");
      traceAction.end("completed", {
        draft_id: detail.current_draft.revision.id,
        job_id: mediaJob.id,
        product_id: detail.product_id,
        workflow_id: mediaJob.workflow_id || "",
      });
    } catch (error) {
      setNotice("The media variation could not be approved. Try again with the current draft.");
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

  if (!productId) return <EmptyState title="Select a product" message="Choose a catalog product to inspect and edit." />;
  if (loading) return <LoadingState label="Loading product editor" />;
  if (error && !product) return <ErrorState title="Product unavailable" onRetry={load} />;
  if (!detail || !product) return null;

  return (
    <VStack align="stretch" gap={6} className="product-editor">
      <HStack justify="space-between" gap={4} align="start" flexWrap="wrap">
        <Box>
          <Text className="section-kicker">Product editor</Text>
          <Text as="h2" className="studio-column-title">{detail.title}</Text>
          <Text className="muted-text">{detail.product_id}</Text>
        </Box>
        <HStack gap={2}>
          <Button type="button" className="secondary-button" disabled={!dirty || saving} onClick={() => applyDetail(detail)}>
            Discard edits
          </Button>
          <Button type="button" className="primary-button" disabled={!dirty || saving} onClick={save}>
            <FiSave /> {saving ? "Saving…" : "Save draft"}
          </Button>
        </HStack>
      </HStack>

      {conflict ? (
        <Box className="catalog-conflict-alert" role="alert">
          <Text className="panel-title">A newer server revision exists</Text>
          <Text>Your local edits are preserved. Reload only when you are ready to replace them with the current server version.</Text>
          <Button type="button" className="secondary-button" mt={3} onClick={load}><FiRefreshCw /> Reload server version</Button>
        </Box>
      ) : null}
      {serverErrors.length ? (
        <Box className="catalog-validation-summary" role="alert">
          <Text className="panel-title">The server rejected these fields</Text>
          {serverErrors.map((message) => <Text key={message}>{message}</Text>)}
        </Box>
      ) : null}
      {error && product ? <Text className="error-copy">The draft could not be saved. Your local edits are still available.</Text> : null}
      {notice ? <Text className="notice-text">{notice}</Text> : null}

      <Box className="catalog-editor-guidance">
        <Text className="panel-title">How catalog changes work</Text>
        <Text className="muted-text">
          Edits and image changes are saved to a private draft. Publish promotes that draft to the storefront. Archive removes the product from shopping surfaces while retaining its catalog history.
        </Text>
      </Box>

      <ProductMediaEditor
        media={product.media || []}
        fallbackCoreUrl={variantImageUrl(product.variants[product.primary_variant_index || 0])}
        busy={mediaBusy}
        job={mediaJob}
        onChange={updateMedia}
        onGenerate={generateMedia}
        onApprove={approveMedia}
      />

      <Box className="editor-section">
        <Text className="panel-title" mb={4}>Product information</Text>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
          <Box><Text className="filter-label">Title</Text><Input aria-label="Product title" value={product.title} onChange={updateProduct("title")} /><FieldError message={errors.title} /></Box>
          <Box><Text className="filter-label">Brand</Text><Input aria-label="Product brand" value={product.brand} onChange={updateProduct("brand")} /><FieldError message={errors.brand} /></Box>
          <Box><Text className="filter-label">Category</Text><Input aria-label="Product category" value={product.category} onChange={updateProduct("category")} /><FieldError message={errors.category} /></Box>
          <Box><Text className="filter-label">Seed run ID</Text><Input aria-label="Seed run ID" value={product.seed_run_id} onChange={updateProduct("seed_run_id")} /><FieldError message={errors.seed_run_id} /></Box>
        </SimpleGrid>
        <Box mt={4}><Text className="filter-label">Description</Text><Textarea aria-label="Product description" value={product.description} onChange={updateProduct("description")} rows={4} /><FieldError message={errors.description} /></Box>
        <Box mt={4}><Text className="filter-label">Metadata JSON</Text><Textarea aria-label="Product metadata JSON" value={metadataText} onChange={(event) => setMetadataText(event.target.value)} rows={4} fontFamily="mono" /><FieldError message={errors.metadata} /></Box>
      </Box>

      <Box className="editor-section">
        <HStack justify="space-between" mb={4}>
          <Box><Text className="panel-title">Sellable options and inventory</Text><FieldError message={errors.variants} /></Box>
          <Button type="button" size="sm" className="secondary-button" onClick={addVariant}><FiPlus /> Add sellable option</Button>
        </HStack>
        <VStack align="stretch" gap={5}>
          {product.variants.map((variant, variantIndex) => (
            <Box key={variant.variant_id || `variant-${variantIndex}`} className="catalog-variant-editor">
              <HStack justify="space-between" mb={4}>
                <HStack><Text className="panel-title">Variant {variantIndex + 1}</Text>{variant.variant_id ? <Badge className="soft-badge">{variant.variant_id}</Badge> : null}</HStack>
                <Button type="button" size="sm" variant="ghost" className="danger-button" onClick={() => removeVariant(variantIndex)}><FiTrash2 /> Remove</Button>
              </HStack>
              <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap={3}>
                {["color", "material", "gender", "season"].map((field) => (
                  <Box key={field}><Text className="filter-label">{field}</Text><Input aria-label={`Variant ${variantIndex + 1} ${field}`} value={variant[field] || ""} onChange={updateVariant(variantIndex, field)} /></Box>
                ))}
                <Box><Text className="filter-label">Minimum price</Text><Input aria-label={`Variant ${variantIndex + 1} minimum price`} type="number" min="0" value={variant.price_min} onChange={updateVariant(variantIndex, "price_min")} /><FieldError message={errors[`variant.${variantIndex}.price_min`]} /></Box>
                <Box><Text className="filter-label">Maximum price</Text><Input aria-label={`Variant ${variantIndex + 1} maximum price`} type="number" min="0" value={variant.price_max} onChange={updateVariant(variantIndex, "price_max")} /><FieldError message={errors[`variant.${variantIndex}.price_max`]} /></Box>
                <Box><Text className="filter-label">Product link</Text><Input aria-label={`Variant ${variantIndex + 1} product link`} value={variant.link || ""} onChange={updateVariant(variantIndex, "link")} /></Box>
              </SimpleGrid>

              <HStack justify="space-between" mt={5} mb={3}>
                <Box><Text className="filter-label">Inventory</Text><FieldError message={errors[`variant.${variantIndex}.inventory`]} /></Box>
                <Button type="button" size="sm" className="secondary-button" onClick={() => addInventory(variantIndex)}><FiPlus /> Add inventory</Button>
              </HStack>
              <VStack align="stretch" gap={3}>
                {variant.inventory.map((row, inventoryIndex) => (
                  <SimpleGrid key={`${row.store_id}-${inventoryIndex}`} columns={{ base: 1, md: 2, xl: 6 }} gap={3} className="catalog-inventory-row">
                    <Box><Text className="filter-label">Store</Text><Input aria-label={`Variant ${variantIndex + 1} inventory ${inventoryIndex + 1} store`} value={row.store_id} onChange={updateInventory(variantIndex, inventoryIndex, "store_id")} /><FieldError message={errors[`inventory.${variantIndex}.${inventoryIndex}.store_id`]} /></Box>
                    <Box><Text className="filter-label">Size</Text><Input aria-label={`Variant ${variantIndex + 1} inventory ${inventoryIndex + 1} size`} value={row.size || ""} onChange={updateInventory(variantIndex, inventoryIndex, "size")} /></Box>
                    <Box><Text className="filter-label">Availability</Text><Input aria-label={`Variant ${variantIndex + 1} inventory ${inventoryIndex + 1} availability`} value={row.availability} onChange={updateInventory(variantIndex, inventoryIndex, "availability")} /><FieldError message={errors[`inventory.${variantIndex}.${inventoryIndex}.availability`]} /></Box>
                    <Box><Text className="filter-label">Quantity</Text><Input aria-label={`Variant ${variantIndex + 1} inventory ${inventoryIndex + 1} quantity`} type="number" min="0" value={row.inventory_qty} onChange={updateInventory(variantIndex, inventoryIndex, "inventory_qty")} /><FieldError message={errors[`inventory.${variantIndex}.${inventoryIndex}.inventory_qty`]} /></Box>
                    <Box><Text className="filter-label">Weight</Text><Input aria-label={`Variant ${variantIndex + 1} inventory ${inventoryIndex + 1} weight`} type="number" min="0" max="1" step="0.1" value={row.objective_weight || 0} onChange={updateInventory(variantIndex, inventoryIndex, "objective_weight")} /><FieldError message={errors[`inventory.${variantIndex}.${inventoryIndex}.objective_weight`]} /></Box>
                    <Button type="button" size="sm" variant="ghost" alignSelf="end" className="danger-button" onClick={() => removeInventory(variantIndex, inventoryIndex)}><FiTrash2 /> Remove</Button>
                  </SimpleGrid>
                ))}
              </VStack>
            </Box>
          ))}
        </VStack>
      </Box>

      <ProductLifecycleActions product={detail} dirty={dirty} onChanged={lifecycleChanged} />
    </VStack>
  );
}

export default function ProductEditor(props) {
  if (Number(props.authoringSchemaVersion || 1) >= 2) {
    return <CanonicalProductEditor {...props} />;
  }
  return <CompatibilityProductEditor {...props} />;
}
