import { Box, Button, Container, HStack, NativeSelect, Text } from "@chakra-ui/react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom";
import { FiArrowLeft, FiRefreshCw } from "react-icons/fi";
import { useCallback, useEffect, useState } from "react";

import ChatWidget from "../components/ChatWidget";
import ProductGrid from "../components/ProductGrid";
import { ErrorState, LoadingState } from "../components/StatusState";
import { DEFAULT_STORE_ID, getCategoryProducts } from "../utils/apiClient";
import { titleize } from "../utils/format";

const sortOptions = [
  ["relevance", "Relevance"],
  ["newest", "Newest"],
  ["price_asc", "Price ascending"],
  ["price_desc", "Price descending"],
  ["inventory_desc", "Inventory"],
];

export default function CategoryPage() {
  const { category } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const sort = searchParams.get("sort") || "relevance";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCategoryProducts(category, { sort, limit: 24 });
      setPayload(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [category, sort]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSort = (event) => {
    setSearchParams({ sort: event.target.value });
  };

  if (loading) return <LoadingState label={`Loading ${titleize(category)}`} />;

  return (
    <Container maxW="1280px" py={10}>
      <Button as={RouterLink} to="/" variant="ghost" className="text-button" mb={5}>
        <FiArrowLeft />
        Back to shop
      </Button>

      <HStack justify="space-between" align="end" gap={4} flexWrap="wrap" mb={7}>
        <Box>
          <Text className="section-kicker">Category</Text>
          <Text className="page-title">{titleize(category)}</Text>
          {payload ? <Text className="muted-text">{payload.total} catalog items</Text> : null}
        </Box>
        <HStack gap={3}>
          <NativeSelect.Root width="220px">
            <NativeSelect.Field value={sort} onChange={updateSort} className="native-select">
              {sortOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Button onClick={load} className="secondary-button">
            <FiRefreshCw />
            Refresh
          </Button>
        </HStack>
      </HStack>

      <Box mb={7}>
        <ChatWidget
          title={`Ask about ${titleize(category)}`}
          context={{
            page_type: "category",
            category,
            store_id: DEFAULT_STORE_ID || undefined,
          }}
        />
      </Box>

      {error ? <ErrorState onRetry={load} /> : <ProductGrid products={payload?.items || []} />}
    </Container>
  );
}
