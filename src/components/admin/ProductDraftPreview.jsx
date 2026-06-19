import { Badge, Box, Button, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { FiRefreshCw } from "react-icons/fi";

import ProductImage from "../ProductImage";

function mediaUrl(asset) {
  return asset?.image_set?.primary_url || asset?.image_set?.thumbnail_url || asset?.image_set?.detail_urls?.[0] || "";
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(number) : "—";
}

export default function ProductDraftPreview({ payload, loading = false, error = "", dirty = false, onRetry }) {
  const product = payload?.preview;
  const media = [...(product?.media || [])].sort((left, right) => left.display_order - right.display_order);
  const inventory = product?.inventory || [];

  return (
    <Box className="editor-section product-draft-preview">
      <HStack justify="space-between" gap={3} align="start" flexWrap="wrap">
        <Box>
          <Text className="section-kicker">Draft preview</Text>
          <Text className="panel-title">Canonical storefront projection</Text>
          <Text className="muted-text">This is the backend projection that will be published; private supplier references are excluded.</Text>
        </Box>
        {payload ? <Badge className="soft-badge">Draft v{payload.draft_version}</Badge> : null}
      </HStack>
      {loading ? <Text className="muted-text" mt={4}>Loading the saved draft preview…</Text> : null}
      {error ? <HStack mt={4} justify="space-between"><Text className="error-copy">{error}</Text><Button type="button" size="sm" className="secondary-button" onClick={onRetry}><FiRefreshCw /> Retry</Button></HStack> : null}
      {dirty ? <Text className="catalog-action-hint" mt={4}>Preview reflects the last saved draft. Save to include current edits.</Text> : null}
      {product && !loading ? (
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={5} mt={5} className="catalog-draft-preview-grid">
          <Box>
            {media.length ? (
              <SimpleGrid columns={{ base: 2, md: 3 }} gap={2}>
                {media.map((asset, index) => <ProductImage key={asset.media_id} src={mediaUrl(asset)} alt={asset.alt_text || `${product.title} image ${index + 1}`} ratio="1 / 1" />)}
              </SimpleGrid>
            ) : <Box className="catalog-editor-guidance"><Text className="muted-text">No approved gallery images in this draft.</Text></Box>}
          </Box>
          <VStack align="stretch" gap={3}>
            <Box><Text className="section-kicker">{product.brand}</Text><Text as="h3" className="studio-column-title">{product.title}</Text></Box>
            <Text whiteSpace="pre-wrap">{product.description}</Text>
            <HStack gap={2} flexWrap="wrap"><Badge className="soft-badge">{money(product.price_min)}{Number(product.price_max) !== Number(product.price_min) ? ` – ${money(product.price_max)}` : ""}</Badge><Badge className="soft-badge">{inventory.length} store {inventory.length === 1 ? "entry" : "entries"}</Badge></HStack>
            {product.benefits?.length ? <Box><Text className="filter-label">Benefits</Text>{product.benefits.map((benefit) => <Text key={benefit}>• {benefit}</Text>)}</Box> : null}
            {inventory.length ? <Box><Text className="filter-label">Availability</Text>{inventory.map((row, index) => <Text key={`${row.store_id}:${row.size || index}`}>{row.store_id}{row.size ? ` · ${row.size}` : ""}: {row.availability} ({row.inventory_qty})</Text>)}</Box> : null}
          </VStack>
        </SimpleGrid>
      ) : null}
    </Box>
  );
}
