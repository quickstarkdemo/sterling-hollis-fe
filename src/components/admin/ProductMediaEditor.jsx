import { Badge, Box, Button, HStack, Input, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { FiArrowDown, FiArrowUp, FiImage, FiPlus, FiTrash2 } from "react-icons/fi";

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

export default function ProductMediaEditor({
  media = [],
  fallbackCoreUrl = "",
  busy = false,
  job,
  onChange,
  onGenerate,
  onApprove,
}) {
  const [intent, setIntent] = useState("scene");
  const [instruction, setInstruction] = useState("");
  const core = media.find((asset) => asset.role === "core");

  const normalizeOrder = (next) => next.map((asset, index) => ({ ...asset, display_order: index }));
  const update = (next) => onChange?.(normalizeOrder(next));
  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= media.length) return;
    if (media[index].role === "core" || media[target].role === "core") return;
    const next = [...media];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };

  const promoteFallback = () => {
    if (!fallbackCoreUrl || core) return;
    update([{
      media_id: newMediaId(),
      role: "core",
      intent: "manual",
      source_media_id: null,
      parameters: {},
      image_set: { primary_url: fallbackCoreUrl, thumbnail_url: fallbackCoreUrl, detail_urls: [fallbackCoreUrl] },
      approval_status: "approved",
      display_order: 0,
      provenance: { source: "existing_catalog_image" },
    }, ...media]);
  };

  const generate = () => {
    if (!core || !instruction.trim()) return;
    onGenerate?.({
      source_media_id: core.media_id,
      intent,
      parameters: intent === "freeform" ? {} : { [intent]: instruction.trim() },
      instruction: intent === "freeform" ? instruction.trim() : undefined,
    });
  };

  return (
    <Box className="editor-section product-media-editor">
      <HStack justify="space-between" gap={3} mb={4} flexWrap="wrap">
        <Box>
          <Text className="panel-title">Product media</Text>
          <Text className="muted-text">Core and generated gallery views do not create sellable options or inventory.</Text>
        </Box>
        {!core && fallbackCoreUrl ? (
          <Button type="button" size="sm" className="secondary-button" onClick={promoteFallback}>
            <FiImage /> Use current image as core
          </Button>
        ) : null}
      </HStack>

      {media.length ? (
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={4} className="catalog-image-grid">
          {media.map((asset, index) => {
            const url = mediaUrl(asset);
            return (
              <Box key={asset.media_id} className="catalog-image-card">
                <ProductImage src={url} alt={`${asset.role === "core" ? "Core" : asset.intent} product view`} className="catalog-editor-image" ratio="1 / 1" />
                <VStack align="stretch" gap={3} className="catalog-image-controls">
                  <HStack justify="space-between">
                    <Box>
                      <Text className="panel-title">{asset.role === "core" ? "Core image" : `${asset.intent} view`}</Text>
                      <Text className="muted-text">Gallery view, not a purchasable option</Text>
                    </Box>
                    <Badge className="soft-badge">{asset.approval_status}</Badge>
                  </HStack>
                  <HStack gap={2} flexWrap="wrap">
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move ${asset.intent} view up`} disabled={index === 0 || asset.role === "core" || media[index - 1]?.role === "core"} onClick={() => move(index, -1)}><FiArrowUp /></Button>
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move ${asset.intent} view down`} disabled={index === media.length - 1 || asset.role === "core" || media[index + 1]?.role === "core"} onClick={() => move(index, 1)}><FiArrowDown /></Button>
                    <Button type="button" size="sm" variant="ghost" className="danger-button" disabled={asset.role === "core" && media.length > 1} onClick={() => update(media.filter((row) => row.media_id !== asset.media_id))}><FiTrash2 /> Remove</Button>
                  </HStack>
                </VStack>
              </Box>
            );
          })}
        </SimpleGrid>
      ) : <Text className="muted-text">No product media has been defined.</Text>}

      <Box mt={5} className="catalog-media-command">
        <Text className="filter-label">Add image variation</Text>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} mt={2}>
          <select aria-label="Image variation intent" value={intent} onChange={(event) => setIntent(event.target.value)} className="catalog-select">
            {INTENTS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <Input aria-label="Image variation instruction" value={instruction} maxLength={2000} onChange={(event) => setInstruction(event.target.value)} placeholder="Describe the color, angle, scene, scale, or people context" />
          <Button type="button" className="primary-button" disabled={!core || !instruction.trim() || busy} onClick={generate}><FiPlus /> {busy ? "Generating..." : "Generate variation"}</Button>
        </SimpleGrid>
        {!core ? <Text className="field-error" mt={2}>Choose a core image before generating variations.</Text> : null}
        {job ? (
          <HStack mt={3} gap={3} flexWrap="wrap">
            <Badge className="soft-badge">{job.status}</Badge>
            <Text className="muted-text">{job.intent} variation</Text>
            {job.status === "succeeded" ? <Button type="button" size="sm" className="secondary-button" onClick={onApprove}>Approve variation</Button> : null}
          </HStack>
        ) : null}
      </Box>
    </Box>
  );
}
