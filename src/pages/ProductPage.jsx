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
import { FiArrowLeft, FiHeart, FiMail, FiMapPin } from "react-icons/fi";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePageChatContext } from "../components/ChatContext";
import ProductCard from "../components/ProductCard";
import ProductImage from "../components/ProductImage";
import ProductGrid from "../components/ProductGrid";
import { ErrorState, LoadingState } from "../components/StatusState";
import { DEFAULT_STORE_ID, getProduct, getProductRecommendations, getRelatedProducts } from "../utils/apiClient";
import { detailImages, inventoryByStore, money, titleize } from "../utils/format";
import { trackAction } from "../utils/datadog";

export default function ProductPage() {
  const { productId } = useParams();
  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [selectedView, setSelectedView] = useState(0);

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
      setSelectedView(0);
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
  const storeAvailability = useMemo(() => inventoryByStore(product), [product]);

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
  const reviews = product.reviews || [];

  return (
    <Container maxW="1280px" py={10}>
      <Button as={RouterLink} to="/" variant="ghost" className="text-button" mb={5}>
        <FiArrowLeft />
        Back to shop
      </Button>

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={{ base: 8, lg: 12 }} alignItems="start">
        <VStack align="stretch" gap={3} className="product-media-gallery">
          <ProductImage
            src={gallery[selectedView] || ""}
            alt={`${product.title} view ${selectedView + 1}`}
            ratio="1 / 1.15"
          />
          {gallery.length > 1 ? (
            <HStack gap={2} flexWrap="wrap" aria-label="Product gallery views">
              {gallery.map((src, index) => (
                <Button
                  type="button"
                  key={`${src}-${index}`}
                  variant="ghost"
                  className={selectedView === index ? "gallery-thumbnail selected" : "gallery-thumbnail"}
                  aria-label={`Show product view ${index + 1}`}
                  aria-pressed={selectedView === index}
                  onClick={() => setSelectedView(index)}
                >
                  <ProductImage src={src} alt="" ratio="1 / 1" />
                </Button>
              ))}
            </HStack>
          ) : null}
          {product.media?.length ? <Text className="muted-text">Gallery views show approved product photography. Selecting a view does not change price or availability.</Text> : null}
        </VStack>

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

      {storeAvailability.length ? (
        <Box mt={14}>
          <HStack mb={5} gap={3}>
            <FiMapPin />
            <Text as="h2" className="section-title">Store availability</Text>
          </HStack>
          <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap={4}>
            {storeAvailability.map((store) => (
              <Box key={store.storeId} className="store-availability-card">
                <Text className="store-availability-title">Store {store.storeId}</Text>
                <HStack mt={3} gap={2} flexWrap="wrap">
                  <Badge className={`availability ${store.availability}`}>{titleize(store.availability)}</Badge>
                  <Badge className="soft-badge">{store.units} units</Badge>
                  {store.sizes.map((size) => <Badge key={size} className="soft-badge">{titleize(size)}</Badge>)}
                </HStack>
              </Box>
            ))}
          </SimpleGrid>
        </Box>
      ) : null}

      {reviews.length ? (
        <Box as="section" mt={14} aria-labelledby="customer-reviews-title">
          <HStack justify="space-between" gap={3} mb={5} flexWrap="wrap">
            <Box>
              <Text className="section-kicker">Customer feedback</Text>
              <Text as="h2" id="customer-reviews-title" className="section-title">Customer reviews</Text>
            </Box>
            <Badge className="soft-badge">{reviews.length} {reviews.length === 1 ? "review" : "reviews"}</Badge>
          </HStack>
          <VStack align="stretch" gap={4} className="public-review-list">
            {reviews.map((review) => (
              <Box as="article" key={review.id} className="public-review-card">
                <HStack justify="space-between" align="start" gap={3} flexWrap="wrap">
                  <Box>
                    <Text className="store-availability-title">{review.author_display_name}</Text>
                    <Text className="muted-text">Verified customer review</Text>
                  </Box>
                  <Text className="product-review-rating" aria-label={`${review.rating} out of 5 stars`}>
                    {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                  </Text>
                </HStack>
                <Text mt={4} whiteSpace="pre-wrap">{review.body}</Text>
                {review.merchant_response ? (
                  <Box className="public-merchant-response" mt={4}>
                    <Text className="filter-label">Sterling Hollis response</Text>
                    <Text mt={1} whiteSpace="pre-wrap">{review.merchant_response}</Text>
                  </Box>
                ) : null}
              </Box>
            ))}
          </VStack>
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
