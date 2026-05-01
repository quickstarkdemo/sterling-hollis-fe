import {
  Badge,
  Box,
  Button,
  Container,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { FiArrowLeft, FiHeart, FiMail, FiPackage } from "react-icons/fi";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePageChatContext } from "../components/ChatContext";
import ProductCard from "../components/ProductCard";
import ProductImage from "../components/ProductImage";
import ProductGrid from "../components/ProductGrid";
import { ErrorState, LoadingState } from "../components/StatusState";
import { DEFAULT_STORE_ID, getProduct, getProductRecommendations, getRelatedProducts } from "../utils/apiClient";
import { detailImages, money, titleize } from "../utils/format";
import { trackAction } from "../utils/datadog";

function variantTitle(variant, fallbackTitle) {
  const attributes = Object.entries(variant.attributes || {})
    .filter(([key, value]) => value && ["color", "material"].includes(key))
    .map(([, value]) => titleize(value));
  if (attributes.length) return attributes.join(" / ");

  const sizes = (variant.sizes || []).filter(Boolean).map(titleize);
  if (sizes.length) return sizes.join(" / ");

  return fallbackTitle;
}

function variantStockBadges(variant) {
  const totals = (variant.inventory || []).reduce((summary, row) => {
    const label = titleize(row.stock_state || row.availability || "available");
    summary[label] = (summary[label] || 0) + Number(row.inventory_qty || 0);
    return summary;
  }, {});

  return Object.entries(totals).map(([label, quantity]) => `${quantity} ${label.toLowerCase()}`);
}

export default function ProductPage() {
  const { productId } = useParams();
  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");

  const chatContext = useMemo(() => {
    const baseContext = {
      page_type: "product",
      product_id: product?.id || productId,
      category: product?.category,
      store_id: DEFAULT_STORE_ID || undefined,
    };

    if (!product) return baseContext;

    return {
      ...baseContext,
      current_product: {
        id: product.id,
        title: product.title,
        category: product.category,
        brand: product.brand,
        attributes: product.attributes || {},
      },
    };
  }, [product, productId]);
  usePageChatContext(chatContext);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await getProduct(productId);
      const [relatedData, recData] = await Promise.all([
        getRelatedProducts(productId, { limit: 4 }),
        getProductRecommendations({ category: detail.category, brand: detail.brand, top_k: 4 }),
      ]);
      setProduct(detail);
      setRelated(relatedData.items || []);
      setRecommendations(recData.recommendations || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const gallery = useMemo(() => detailImages(product), [product]);

  const handleStub = (action) => {
    trackAction(action, { product_id: product?.id, title: product?.title });
    setNotice(action === "contact_associate" ? "Associate contact request captured for demo." : "Saved to wishlist for demo.");
  };

  if (loading) return <LoadingState label="Loading product detail" />;
  if (error || !product) {
    return (
      <Container maxW="1100px" py={16}>
        <ErrorState title="Product unavailable" onRetry={load} />
      </Container>
    );
  }

  const inventory = product.inventory_summary || {};

  return (
    <Container maxW="1280px" py={10}>
      <Button as={RouterLink} to="/" variant="ghost" className="text-button" mb={5}>
        <FiArrowLeft />
        Back to shop
      </Button>

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={{ base: 8, lg: 12 }} alignItems="start">
        <SimpleGrid columns={{ base: 1, md: gallery.length > 1 ? 2 : 1 }} gap={4}>
          {(gallery.length ? gallery : [""]).slice(0, 4).map((src, index) => (
            <ProductImage key={`${src}-${index}`} src={src} alt={`${product.title} view ${index + 1}`} ratio="1 / 1.15" />
          ))}
        </SimpleGrid>

        <VStack align="stretch" gap={6}>
          <Box>
            <Text className="section-kicker">{product.brand}</Text>
            <Text className="page-title">{product.title}</Text>
            <Text className="pdp-price">
              {product.price_min === product.price_max
                ? money(product.price)
                : `${money(product.price_min)} - ${money(product.price_max)}`}
            </Text>
            <Text className="product-description">{product.description}</Text>
          </Box>

          <HStack gap={3} flexWrap="wrap">
            <Badge className={`availability ${inventory.availability || "unknown"}`}>
              {(inventory.availability || "unknown").replace(/_/g, " ")}
            </Badge>
            <Badge className="soft-badge">{inventory.in_stock_units || 0} in stock</Badge>
            <Badge className="soft-badge">{inventory.store_count || 0} stores</Badge>
          </HStack>

          <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
            {Object.entries(product.attributes || {}).map(([key, value]) => (
              <Box key={key} className="attribute-row">
                <Text>{titleize(key)}</Text>
                <Text>{titleize(value)}</Text>
              </Box>
            ))}
          </SimpleGrid>

          <HStack gap={3} flexWrap="wrap">
            <Button className="primary-button" onClick={() => handleStub("contact_associate")}>
              <FiMail />
              Contact associate
            </Button>
            <Button className="secondary-button" onClick={() => handleStub("wishlist_stub")}>
              <FiHeart />
              Save item
            </Button>
          </HStack>
          {notice ? <Text className="notice-text">{notice}</Text> : null}
        </VStack>
      </SimpleGrid>

      {product.variants?.length ? (
        <Box mt={14}>
          <HStack mb={5} gap={3}>
            <FiPackage />
            <Text className="section-title">Variants and inventory</Text>
          </HStack>
          <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap={4}>
            {product.variants.map((variant) => {
              const stockBadges = variantStockBadges(variant);
              return (
                <Box key={variant.id} className="variant-card">
                  <Text className="variant-title">{variantTitle(variant, product.title)}</Text>
                  <Text className="muted-text">{money(variant.price_min)} - {money(variant.price_max)}</Text>
                  <HStack mt={3} gap={2} flexWrap="wrap">
                    {stockBadges.map((badge) => (
                      <Badge key={badge} className="soft-badge">{badge}</Badge>
                    ))}
                    {(variant.sizes || []).map((size) => (
                      <Badge key={size} className="soft-badge">{titleize(size)}</Badge>
                    ))}
                  </HStack>
                </Box>
              );
            })}
          </SimpleGrid>
        </Box>
      ) : null}

      <Box mt={14}>
        <Text className="section-kicker">Related</Text>
        <Text className="section-title" mb={5}>More from the catalog</Text>
        <ProductGrid products={related} emptyMessage="No related products were returned." />
      </Box>

      {recommendations.length ? (
        <Box mt={14}>
          <Text className="section-kicker">AI rail</Text>
          <Text className="section-title" mb={5}>Backend recommendations</Text>
          <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap={4}>
            {recommendations.map((row) => (
              <ProductCard key={row.product.id} product={row.product} compact />
            ))}
          </SimpleGrid>
        </Box>
      ) : null}
    </Container>
  );
}
