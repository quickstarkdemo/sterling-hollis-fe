import { Box, Button, HStack, Input, SimpleGrid, Text, Textarea, VStack } from "@chakra-ui/react";
import { FiPlus, FiTrash2 } from "react-icons/fi";

import FieldVoiceControl from "./FieldVoiceControl";

const lines = (value) => (value || []).join("\n");
const parseLines = (value) => value.split("\n");
const keywords = (value) => (value || []).join(", ");
const parseKeywords = (value) => value.split(",");

function FieldActions({ label, targetPath, activeVoiceTarget, aiBusyTarget, onVoiceRequest, onAiRequest, showVoice = true, actionsDisabled = false }) {
  return (
    <FieldVoiceControl
      label={label}
      targetPath={targetPath}
      active={activeVoiceTarget === targetPath}
      aiBusy={aiBusyTarget === targetPath}
      onVoiceRequest={onVoiceRequest}
      onAiRequest={onAiRequest}
      showVoice={showVoice}
      disabled={actionsDisabled}
    />
  );
}

export default function ProductContentEditor({
  product,
  onChange,
  activeVoiceTarget = "",
  aiBusyTarget = "",
  onVoiceRequest,
  onAiRequest,
  actionsDisabled = false,
}) {
  const update = (field, value) => onChange?.({ ...product, [field]: value });
  const updateSeo = (field, value) => onChange?.({
    ...product,
    seo: { ...(product.seo || {}), [field]: value },
  });
  const updateSpecification = (index, field, value) => update(
    "specifications",
    (product.specifications || []).map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
  );
  const fieldActionProps = { activeVoiceTarget, aiBusyTarget, onVoiceRequest, onAiRequest, actionsDisabled };

  return (
    <Box className="editor-section product-content-editor">
      <Text className="panel-title">Selling content</Text>
      <Text className="muted-text" mb={4}>Draft shopper-facing copy manually, by voice, or as an AI proposal that stays reviewable until accepted.</Text>

      <VStack align="stretch" gap={5}>
        <Box>
          <HStack justify="space-between" align="center" gap={2} flexWrap="wrap">
            <Text className="filter-label">Description</Text>
            <FieldActions label="Description" targetPath="/description" {...fieldActionProps} />
          </HStack>
          <Textarea aria-label="Product description" value={product.description || ""} onChange={(event) => update("description", event.target.value)} rows={5} />
        </Box>

        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4}>
          <Box>
            <HStack justify="space-between" gap={2} flexWrap="wrap"><Text className="filter-label">Benefits</Text><FieldActions label="Benefits" targetPath="/benefits" {...fieldActionProps} /></HStack>
            <Textarea aria-label="Product benefits" value={lines(product.benefits)} onChange={(event) => update("benefits", parseLines(event.target.value))} rows={5} placeholder="One customer benefit per line" />
          </Box>
          <Box>
            <HStack justify="space-between" gap={2} flexWrap="wrap"><Text className="filter-label">Care instructions</Text><FieldActions label="Care instructions" targetPath="/care_instructions" showVoice={false} {...fieldActionProps} /></HStack>
            <Textarea aria-label="Product care instructions" value={lines(product.care_instructions)} onChange={(event) => update("care_instructions", parseLines(event.target.value))} rows={5} placeholder="One instruction per line" />
          </Box>
          <Box>
            <HStack justify="space-between" gap={2} flexWrap="wrap"><Text className="filter-label">Content details</Text><FieldActions label="Content details" targetPath="/content_details" showVoice={false} {...fieldActionProps} /></HStack>
            <Textarea aria-label="Product content details" value={lines(product.content_details)} onChange={(event) => update("content_details", parseLines(event.target.value))} rows={5} placeholder="One detail per line" />
          </Box>
          <Box>
            <Text className="filter-label">Required specifications</Text>
            <Input aria-label="Required product specifications" value={keywords(product.readiness_inputs?.required_specifications)} onChange={(event) => onChange?.({ ...product, readiness_inputs: { required_specifications: parseKeywords(event.target.value) } })} placeholder="material, closure" />
            <Text className="muted-text" mt={1}>These names become publish blockers until matching specifications exist.</Text>
          </Box>
        </SimpleGrid>

        <Box>
          <HStack justify="space-between" gap={2} flexWrap="wrap">
            <Box><Text className="filter-label">Specifications</Text><Text className="muted-text">Use stable attribute names so readiness checks can match them.</Text></Box>
            <HStack gap={2}>
              <FieldActions label="Specifications" targetPath="/specifications" {...fieldActionProps} />
              <Button type="button" size="sm" className="secondary-button" onClick={() => update("specifications", [...(product.specifications || []), { name: "", value: "" }])}><FiPlus /> Add specification</Button>
            </HStack>
          </HStack>
          <VStack align="stretch" gap={2} mt={3}>
            {(product.specifications || []).map((specification, index) => (
              <SimpleGrid key={index} columns={{ base: 1, md: 5 }} gap={2}>
                <Input gridColumn={{ md: "span 2" }} aria-label={`Specification ${index + 1} name`} value={specification.name} onChange={(event) => updateSpecification(index, "name", event.target.value)} placeholder="Name" />
                <Input gridColumn={{ md: "span 2" }} aria-label={`Specification ${index + 1} value`} value={specification.value} onChange={(event) => updateSpecification(index, "value", event.target.value)} placeholder="Value" />
                <Button type="button" variant="ghost" className="danger-button" aria-label={`Remove specification ${index + 1}`} onClick={() => update("specifications", product.specifications.filter((_, itemIndex) => itemIndex !== index))}><FiTrash2 /> Remove</Button>
              </SimpleGrid>
            ))}
          </VStack>
        </Box>

        <Box>
          <Text className="panel-title">Search presentation</Text>
          <Text className="muted-text" mb={3}>SEO recommendations never block publication.</Text>
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4}>
            <Box>
              <HStack justify="space-between" gap={2} flexWrap="wrap"><Text className="filter-label">SEO title</Text><FieldActions label="SEO title" targetPath="/seo/title" {...fieldActionProps} /></HStack>
              <Input aria-label="SEO title" value={product.seo?.title || ""} onChange={(event) => updateSeo("title", event.target.value)} />
            </Box>
            <Box>
              <HStack justify="space-between" gap={2} flexWrap="wrap"><Text className="filter-label">SEO keywords</Text><FieldActions label="SEO keywords" targetPath="/seo/keywords" {...fieldActionProps} /></HStack>
              <Input aria-label="SEO keywords" value={keywords(product.seo?.keywords)} onChange={(event) => updateSeo("keywords", parseKeywords(event.target.value))} placeholder="wool coat, outerwear" />
            </Box>
            <Box gridColumn={{ lg: "span 2" }}>
              <HStack justify="space-between" gap={2} flexWrap="wrap"><Text className="filter-label">SEO description</Text><FieldActions label="SEO description" targetPath="/seo/description" {...fieldActionProps} /></HStack>
              <Textarea aria-label="SEO description" value={product.seo?.description || ""} onChange={(event) => updateSeo("description", event.target.value)} rows={3} />
            </Box>
          </SimpleGrid>
        </Box>
      </VStack>
    </Box>
  );
}
