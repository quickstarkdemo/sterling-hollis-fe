import { Badge, Box, Button, HStack, Text } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { FiArrowUpRight, FiHeart } from "react-icons/fi";

import ProductImage from "./ProductImage";
import { imageFor, money } from "../utils/format";
import { trackAction } from "../utils/datadog";

export default function ProductCard({ product, compact = false }) {
  const availability = product?.inventory_summary?.availability || "unknown";

  const handleSave = (event) => {
    event.preventDefault();
    trackAction("wishlist_stub", { product_id: product.id, title: product.title });
  };

  return (
    <RouterLink to={`/product/${product.id}`} className={`product-card ${compact ? "compact" : ""}`}>
      <ProductImage src={imageFor(product)} alt={product.title} />
      <Box className="product-card-body">
        <HStack justify="space-between" align="start" gap={3}>
          <Box minW={0}>
            <Text className="eyebrow">{product.brand}</Text>
            <Text className="product-title">{product.title}</Text>
          </Box>
          <Button size="xs" variant="ghost" className="save-button" onClick={handleSave}>
            <FiHeart />
          </Button>
        </HStack>
        <HStack justify="space-between" align="center" mt={4}>
          <Box>
            <Text className="price">{money(product.price_min === product.price_max ? product.price : product.price_min)}</Text>
            {product.price_min !== product.price_max ? <Text className="muted-mini">from</Text> : null}
          </Box>
          <Badge className={`availability ${availability}`}>{availability.replace(/_/g, " ")}</Badge>
        </HStack>
        <HStack className="card-link" mt={4}>
          <Text>View item</Text>
          <FiArrowUpRight />
        </HStack>
      </Box>
    </RouterLink>
  );
}
