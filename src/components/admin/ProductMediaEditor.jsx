import { Badge, Box, Button, HStack, Input, NativeSelect, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { FiArrowDown, FiArrowUp, FiCheck, FiImage, FiPlus, FiRotateCcw, FiStar, FiTrash2 } from "react-icons/fi";

import ProductImage from "../ProductImage";

const INTENTS = ["color", "angle", "scene", "scale", "people", "freeform"];

function mediaUrl(asset) {
  return asset?.image_set?.primary_url
    || asset?.image_set?.thumbnail_url
    || asset?.image_set?.detail_urls?.[0]
    || "";
}

function newMediaId() {
  return `media_${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);
}

function mediaLabel(asset, index) {
  if (asset.role === "core") return "Main image";
  const intent = asset.intent === "manual" ? "Image variant" : `${asset.intent} image variant`;
  return `${intent} ${index + 1}`;
}

export default function ProductMediaEditor({
  media = [],
  fallbackCoreUrl = "",
  busy = false,
  job,
  onChange,
  onGenerate,
  onApprove,
  mutationsDisabled = false,
}) {
  const [intent, setIntent] = useState("scene");
  const [instruction, setInstruction] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [removed, setRemoved] = useState(null);
  const orderedMedia = useMemo(
    () => [...media].sort((left, right) => left.display_order - right.display_order),
    [media],
  );
  const mainImage = orderedMedia.find((asset) => asset.role === "core");
  const selectedSource = orderedMedia.find((asset) => asset.media_id === selectedSourceId);

  useEffect(() => {
    const selectedIsApproved = orderedMedia.some((asset) => (
      asset.media_id === selectedSourceId && asset.approval_status === "approved"
    ));
    if (selectedIsApproved) return;
    const defaultSource = mainImage?.approval_status === "approved"
      ? mainImage
      : orderedMedia.find((asset) => asset.approval_status === "approved");
    setSelectedSourceId(defaultSource?.media_id || "");
  }, [mainImage, orderedMedia, selectedSourceId]);

  const normalizeOrder = (next) => next.map((asset, index) => ({ ...asset, display_order: index }));
  const update = (next) => onChange?.(normalizeOrder(next));

  const move = (index, offset) => {
    const target = index + offset;
    if (target < 1 || target >= orderedMedia.length || orderedMedia[index]?.role === "core") return;
    const next = [...orderedMedia];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };

  const setMain = (asset) => {
    if (asset.role === "core" || asset.approval_status !== "approved") return;
    const next = orderedMedia
      .map((row) => ({ ...row, role: row.media_id === asset.media_id ? "core" : "variation" }))
      .sort((left, right) => (left.media_id === asset.media_id ? -1 : right.media_id === asset.media_id ? 1 : left.display_order - right.display_order));
    update(next);
  };

  const remove = (asset, index) => {
    if (orderedMedia.length <= 1 || asset.role === "core") return;
    setRemoved({ asset, index });
    update(orderedMedia.filter((row) => row.media_id !== asset.media_id));
    if (selectedSourceId === asset.media_id) setSelectedSourceId(mainImage?.media_id || "");
  };

  const restore = () => {
    if (!removed) return;
    const next = [...orderedMedia];
    next.splice(Math.min(removed.index, next.length), 0, removed.asset);
    update(next);
    setRemoved(null);
  };

  const promoteFallback = () => {
    if (!fallbackCoreUrl || mainImage) return;
    update([{
      media_id: newMediaId(),
      role: "core",
      intent: "manual",
      source_media_id: null,
      predecessor_media_id: null,
      parameters: {},
      image_set: { primary_url: fallbackCoreUrl, thumbnail_url: fallbackCoreUrl, detail_urls: [fallbackCoreUrl] },
      approval_status: "approved",
      display_order: 0,
      provenance: { source: "existing_catalog_image" },
    }, ...orderedMedia]);
  };

  const generate = () => {
    if (!selectedSource || selectedSource.approval_status !== "approved" || !instruction.trim()) return;
    onGenerate?.({
      source_media_id: selectedSource.media_id,
      intent,
      parameters: intent === "freeform" ? {} : { [intent]: instruction.trim() },
      instruction: intent === "freeform" ? instruction.trim() : undefined,
    });
  };

  return (
    <Box id="workbench-media" className="editor-section product-media-editor">
      <HStack justify="space-between" gap={3} mb={4} align="start" flexWrap="wrap">
        <Box>
          <Text className="panel-title">Images</Text>
          <Text className="muted-text">Choose any approved image as an edit source. Image variants never change price or inventory.</Text>
        </Box>
        {!mainImage && fallbackCoreUrl ? (
          <Button type="button" size="sm" className="secondary-button" disabled={mutationsDisabled} onClick={promoteFallback}>
            <FiImage /> Use current image as main
          </Button>
        ) : null}
      </HStack>

      {removed ? (
        <HStack className="catalog-undo-bar" justify="space-between" gap={3} mb={4}>
          <Text>Image variant removed from this draft.</Text>
          <Button type="button" size="sm" variant="ghost" onClick={restore}><FiRotateCcw /> Undo</Button>
        </HStack>
      ) : null}

      {orderedMedia.length ? (
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} className="catalog-image-grid">
          {orderedMedia.map((asset, index) => {
            const url = mediaUrl(asset);
            const label = mediaLabel(asset, index);
            const selected = asset.media_id === selectedSourceId;
            const approved = asset.approval_status === "approved";
            const sourceJob = job && (job.source_media_id === asset.media_id || (!job.source_media_id && selected));
            return (
              <Box key={asset.media_id} className={`catalog-image-card ${selected ? "selected-source" : ""}`}>
                <ProductImage src={url} alt={label} className="catalog-editor-image" ratio="1 / 1" />
                <VStack align="stretch" gap={3} className="catalog-image-controls">
                  <HStack justify="space-between" gap={2} align="start">
                    <Box>
                      <Text className="panel-title">{label}</Text>
                      <Text className="muted-text">{asset.role === "core" ? "Shown first on the storefront" : "Ordered visual asset"}</Text>
                    </Box>
                    <Badge className={`workflow-status ${asset.approval_status}`}>{asset.approval_status}</Badge>
                  </HStack>
                  <HStack gap={2} flexWrap="wrap">
                    <Button type="button" size="sm" className={selected ? "primary-button" : "secondary-button"} disabled={!approved} aria-pressed={selected} onClick={() => setSelectedSourceId(asset.media_id)}>
                      {selected ? <FiCheck /> : <FiImage />} {selected ? "Selected source" : "Use as source"}
                    </Button>
                    {asset.role !== "core" ? <Button type="button" size="sm" variant="ghost" disabled={!approved || mutationsDisabled} onClick={() => setMain(asset)}><FiStar /> Set main</Button> : null}
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move ${label} up`} disabled={mutationsDisabled || index <= 1 || asset.role === "core"} onClick={() => move(index, -1)}><FiArrowUp /></Button>
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move ${label} down`} disabled={mutationsDisabled || index === orderedMedia.length - 1 || asset.role === "core"} onClick={() => move(index, 1)}><FiArrowDown /></Button>
                    <Button type="button" size="sm" variant="ghost" className="danger-button" disabled={mutationsDisabled || asset.role === "core" || orderedMedia.length <= 1} onClick={() => remove(asset, index)}><FiTrash2 /> Remove</Button>
                  </HStack>
                  {sourceJob ? (
                    <Box className="catalog-media-job" aria-live="polite">
                      <HStack gap={2} flexWrap="wrap">
                        <Badge className={`workflow-status ${job.status}`}>{job.status}</Badge>
                        <Text className="muted-text">{job.intent || intent} image variant</Text>
                      </HStack>
                      {job.error_message ? <Text className="field-error">{job.error_message}</Text> : null}
                      {mutationsDisabled ? <Text className="catalog-action-hint">Finish this image candidate before reordering or removing gallery images.</Text> : null}
                      {job.status === "succeeded" ? (
                        <HStack gap={2} mt={2} flexWrap="wrap">
                          <Button type="button" size="sm" className="secondary-button" disabled={busy} onClick={() => onApprove?.({ approval_intent: "add" })}>Approve as new image</Button>
                          <Button type="button" size="sm" className="secondary-button" disabled={busy} onClick={() => onApprove?.({ approval_intent: "replace", replace_media_id: asset.media_id })}>Replace this image</Button>
                        </HStack>
                      ) : null}
                    </Box>
                  ) : null}
                </VStack>
              </Box>
            );
          })}
        </SimpleGrid>
      ) : <Text className="muted-text">No product images are available.</Text>}

      <Box mt={5} className="catalog-media-command">
        <Text className="filter-label">Create an image variant</Text>
        <Text className="muted-text">Source: {selectedSource ? mediaLabel(selectedSource, orderedMedia.indexOf(selectedSource)) : "Select an approved image"}</Text>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} mt={2}>
          <NativeSelect.Root>
            <NativeSelect.Field aria-label="Image variant intent" value={intent} onChange={(event) => setIntent(event.target.value)} className="native-select">
              {INTENTS.map((value) => <option key={value} value={value}>{value}</option>)}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Input aria-label="Image variant instruction" value={instruction} maxLength={2000} onChange={(event) => setInstruction(event.target.value)} placeholder="Describe the color, angle, scene, scale, or people context" />
          <Button type="button" className="primary-button" disabled={!selectedSource || !instruction.trim() || busy} onClick={generate}><FiPlus /> {busy ? "Generating…" : "Generate image variant"}</Button>
        </SimpleGrid>
        {!selectedSource ? <Text className="field-error" mt={2}>Select an approved image before generating a variant.</Text> : null}
      </Box>
    </Box>
  );
}
