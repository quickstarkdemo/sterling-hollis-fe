import { Badge, Box, Button, HStack, Input, Progress, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiImage, FiPlus, FiRefreshCw, FiTrash2, FiUploadCloud } from "react-icons/fi";

import {
  createIdempotencyKey,
  deleteCatalogSourceAsset,
  generateCatalogSuggestionSet,
  getCatalogSourceBundles,
  getCatalogSourcePreview,
  promoteCatalogSourceAsset,
  uploadCatalogSourceBundle,
} from "../../utils/apiClient";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 20;

function validateFiles(files) {
  return files.map((file) => {
    if (!ACCEPTED_TYPES.has(file.type)) return { file, error: "Use a JPEG, PNG, or WebP image." };
    if (!file.size) return { file, error: "The image is empty." };
    if (file.size > MAX_BYTES) return { file, error: "The image is larger than 8 MB." };
    if (file.name.includes("/") || file.name.includes("\\")) return { file, error: "Remove folders from the filename." };
    return { file, error: "" };
  });
}

function sourceError(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (error?.response?.status === 409) return "The product draft changed. Refresh before trying again.";
  if ([502, 503, 504].includes(error?.response?.status)) return "Supplier image processing is temporarily unavailable. Your draft is unchanged.";
  return fallback;
}

function SourcePreview({ asset }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    getCatalogSourcePreview(asset.preview_url).then((blob) => {
      if (!active || !globalThis.URL?.createObjectURL) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL?.(objectUrl);
    };
  }, [asset.preview_url]);

  return url
    ? <img src={url} alt={`Supplier source ${asset.original_filename}`} className="catalog-source-preview" />
    : <Box className="catalog-source-preview placeholder" aria-label={`Preview loading for ${asset.original_filename}`}><FiImage /></Box>;
}

export default function ProductSourceTray({
  productId,
  draft,
  ensureWorkflow,
  onDraftChanged,
  onSuggestionsChanged,
}) {
  const [bundles, setBundles] = useState([]);
  const [selected, setSelected] = useState([]);
  const [title, setTitle] = useState("Supplier handoff");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busyAssetId, setBusyAssetId] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [followUps, setFollowUps] = useState([]);
  const inputRef = useRef(null);
  const loadRequestId = useRef(0);
  const mutationInFlight = useRef(false);

  const load = useCallback(async () => {
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    setLoading(true);
    setError("");
    try {
      const payload = await getCatalogSourceBundles();
      if (loadRequestId.current === requestId) {
        setBundles((payload.items || []).filter((bundle) => (
          bundle.catalog_product_id === productId
          || bundle.draft_revision_id === draft?.revision?.id
        )));
      }
    } catch (nextError) {
      if (loadRequestId.current === requestId) setError(sourceError(nextError, "Supplier sources could not be loaded."));
    } finally {
      if (loadRequestId.current === requestId) setLoading(false);
    }
  }, [draft?.revision?.id, productId]);

  useEffect(() => {
    void load();
    return () => { loadRequestId.current += 1; };
  }, [load]);

  const assets = useMemo(
    () => bundles.flatMap((bundle) => bundle.assets.map((asset) => ({ ...asset, bundle_id: bundle.id }))),
    [bundles],
  );

  const chooseFiles = (fileList) => {
    const files = Array.from(fileList || []).slice(0, MAX_FILES);
    setSelected(validateFiles(files));
    setError(Array.from(fileList || []).length > MAX_FILES ? `Choose no more than ${MAX_FILES} images at once.` : "");
    setNotice("");
  };

  const upload = async () => {
    const valid = selected.filter((item) => !item.error).map((item) => item.file);
    if (!valid.length || selected.some((item) => item.error) || mutationInFlight.current) return;
    mutationInFlight.current = true;
    loadRequestId.current += 1;
    setLoading(false);
    setUploading(true);
    setUploadProgress(0);
    setSelected((current) => current.map((item) => ({ ...item, serverError: "" })));
    setError("");
    setNotice("");
    try {
      const bundle = await uploadCatalogSourceBundle(valid, {
        title: title.trim() || "Supplier handoff",
        catalogProductId: productId,
        draftRevisionId: draft?.revision?.id,
      }, (event) => {
        if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      });
      setBundles((current) => [bundle, ...current.filter((item) => item.id !== bundle.id)]);
      setSelected([]);
      if (inputRef.current) inputRef.current.value = "";
      setNotice(`${bundle.assets.length} supplier ${bundle.assets.length === 1 ? "image" : "images"} uploaded privately.`);
    } catch (nextError) {
      const message = sourceError(nextError, "The supplier images could not be uploaded.");
      setSelected((current) => current.map((item) => ({ ...item, serverError: message })));
      setError(message);
    } finally {
      mutationInFlight.current = false;
      setUploading(false);
    }
  };

  const removeAsset = async (asset) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    loadRequestId.current += 1;
    setLoading(false);
    setBusyAssetId(asset.id);
    setError("");
    try {
      await deleteCatalogSourceAsset(asset.bundle_id, asset.id);
      setBundles((current) => current
        .map((bundle) => bundle.id === asset.bundle_id
          ? { ...bundle, assets: bundle.assets.filter((item) => item.id !== asset.id) }
          : bundle)
        .filter((bundle) => bundle.assets.length));
      setNotice(`${asset.original_filename} removed from private sources.`);
    } catch (nextError) {
      setError(sourceError(nextError, "The supplier image could not be removed."));
    } finally {
      mutationInFlight.current = false;
      setBusyAssetId("");
    }
  };

  const promoteAsset = async (asset) => {
    if (!draft || mutationInFlight.current) return;
    mutationInFlight.current = true;
    loadRequestId.current += 1;
    setLoading(false);
    setBusyAssetId(asset.id);
    setError("");
    try {
      const result = await promoteCatalogSourceAsset(asset.bundle_id, asset.id, {
        draft_id: draft.revision.id,
        expected_draft_version: draft.draft_version,
      }, createIdempotencyKey(`promote-source-${asset.id}`));
      setBundles((current) => current.map((bundle) => bundle.id === asset.bundle_id
        ? { ...bundle, assets: bundle.assets.map((item) => item.id === asset.id ? result.asset : item) }
        : bundle));
      setNotice(`${asset.original_filename} promoted to approved product media.`);
      onDraftChanged?.(result);
    } catch (nextError) {
      setError(sourceError(nextError, "The supplier image could not be promoted."));
    } finally {
      mutationInFlight.current = false;
      setBusyAssetId("");
    }
  };

  const analyze = async () => {
    if (!draft || !assets.length || mutationInFlight.current) return;
    mutationInFlight.current = true;
    loadRequestId.current += 1;
    setLoading(false);
    setAnalyzing(true);
    setError("");
    setNotice("");
    try {
      const workflowId = await ensureWorkflow?.();
      if (!workflowId) throw new Error("workflow_unavailable");
      const result = await generateCatalogSuggestionSet(productId, {
        draft_id: draft.revision.id,
        expected_draft_version: draft.draft_version,
        workflow_id: workflowId,
        instruction: "Use only visible supplier evidence. Propose useful merchandising copy and observed product attributes; leave unsupported facts unknown.",
        input_origin: "supplier_analysis",
        source_asset_ids: assets.map((asset) => asset.id),
        target_paths: ["/description", "/color", "/material", "/benefits", "/specifications"],
      }, createIdempotencyKey("supplier-analysis"));
      setFollowUps(result.follow_up_questions || []);
      setNotice(result.message || "Supplier analysis is ready for review.");
      onSuggestionsChanged?.(result.suggestion_set);
    } catch (nextError) {
      setError(sourceError(nextError, "Supplier analysis could not be completed. Your draft is unchanged."));
    } finally {
      mutationInFlight.current = false;
      setAnalyzing(false);
    }
  };

  const drop = (event) => {
    event.preventDefault();
    if (!uploading) chooseFiles(event.dataTransfer.files);
  };

  return (
    <Box id="workbench-sources" className="editor-section product-source-tray">
      <HStack justify="space-between" gap={3} align="start" flexWrap="wrap">
        <Box>
          <Text className="section-kicker">Supplier sources</Text>
          <Text className="panel-title">Private product evidence</Text>
          <Text className="muted-text">Upload the supplier handoff first. AI suggestions stay reviewable and these originals never become public unless you promote one.</Text>
        </Box>
        <Button type="button" size="sm" className="secondary-button" aria-label="Refresh supplier sources" onClick={load} disabled={loading || uploading || analyzing || Boolean(busyAssetId)}><FiRefreshCw /> Refresh</Button>
      </HStack>

      <Box
        className="catalog-source-dropzone"
        as="label"
        htmlFor="catalog-supplier-files"
        role="button"
        tabIndex={0}
        aria-label="Upload supplier images"
        onKeyDown={(event) => {
          if (!["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          inputRef.current?.click();
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        <FiUploadCloud />
        <Text className="panel-title">Drop supplier images here</Text>
        <Text className="muted-text">JPEG, PNG, or WebP · up to 8 MB each · ordered as selected</Text>
        <input id="catalog-supplier-files" ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFiles(event.target.files)} hidden />
      </Box>

      {selected.length ? (
        <VStack align="stretch" gap={2} mt={4} aria-label="Selected supplier files">
          <Input aria-label="Supplier bundle title" value={title} onChange={(event) => setTitle(event.target.value)} />
          {selected.map((item, index) => (
            <HStack key={`${item.file.name}-${index}`} className="catalog-source-file" justify="space-between">
              <Text>{index + 1}. {item.file.name}</Text>
              <Badge className={item.error || item.serverError ? "workflow-status failed" : uploading ? "workflow-status running" : "workflow-status ready"}>{item.error || item.serverError || (uploading ? `uploading ${uploadProgress}%` : "ready")}</Badge>
            </HStack>
          ))}
          {uploading ? <Progress.Root value={uploadProgress}><Progress.Track><Progress.Range /></Progress.Track></Progress.Root> : null}
          <HStack justify="end"><Button type="button" className="primary-button" onClick={upload} disabled={uploading || analyzing || Boolean(busyAssetId) || selected.some((item) => item.error)}><FiPlus /> {uploading ? `Uploading ${uploadProgress}%` : "Upload sources"}</Button></HStack>
        </VStack>
      ) : null}

      {loading ? <Text className="muted-text" mt={4}>Loading private supplier sources…</Text> : null}
      {!loading && !assets.length ? <Text className="muted-text" mt={4}>No supplier images are attached to this product yet.</Text> : null}
      {assets.length ? (
        <VStack align="stretch" gap={3} mt={5}>
          {assets.map((asset) => (
            <HStack key={asset.id} className="catalog-source-card" gap={4} align="center">
              <SourcePreview asset={asset} />
              <Box flex="1" minW={0}>
                <Text className="panel-title">{asset.original_filename}</Text>
                <Text className="muted-text">{asset.width} × {asset.height} · {Math.round(asset.byte_size / 1024)} KB</Text>
                <Badge className={`workflow-status ${asset.status === "promoted" ? "succeeded" : "ready"}`}>{asset.status}</Badge>
              </Box>
              <HStack gap={2} flexWrap="wrap" justify="end">
                {asset.status !== "promoted" ? <Button type="button" size="sm" className="secondary-button" disabled={!draft || uploading || analyzing || Boolean(busyAssetId)} onClick={() => promoteAsset(asset)}><FiImage /> Promote to media</Button> : null}
                {asset.status !== "promoted" ? <Button type="button" size="sm" variant="ghost" className="danger-button" disabled={uploading || analyzing || Boolean(busyAssetId)} onClick={() => removeAsset(asset)}><FiTrash2 /> Remove</Button> : null}
              </HStack>
            </HStack>
          ))}
          <Button type="button" className="primary-button" disabled={!draft || uploading || analyzing || Boolean(busyAssetId)} onClick={analyze}><FiImage /> {analyzing ? "Analyzing supplier evidence…" : "Generate suggestions from sources"}</Button>
        </VStack>
      ) : null}

      {followUps.length ? <Box className="catalog-follow-up" mt={4}><Text className="panel-title">Supplier follow-up needed</Text>{followUps.map((item) => <Text key={item.target_path}>{item.question}</Text>)}</Box> : null}
      {notice ? <Text className="notice-text" mt={4}>{notice}</Text> : null}
      {error ? <Text className="error-copy" role="alert" mt={4}>{error}</Text> : null}
    </Box>
  );
}
