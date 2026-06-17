import { Badge, Box, Button, HStack, Input, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiRefreshCw, FiSearch } from "react-icons/fi";

import { EmptyState, ErrorState, LoadingState } from "../StatusState";
import { getAdminCatalogProducts } from "../../utils/apiClient";
import { titleize } from "../../utils/format";

const PAGE_SIZE = 12;

export default function CatalogProductList({ selectedProductId, onSelect, refreshKey = 0 }) {
  const [query, setQuery] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setLoading(true);
    setError(null);
    try {
      const nextPayload = await getAdminCatalogProducts({
        q: query,
        lifecycle_status: lifecycleStatus,
        category,
        brand,
        page,
        page_size: PAGE_SIZE,
      });
      if (requestId.current === currentRequestId) setPayload(nextPayload);
    } catch (nextError) {
      if (requestId.current === currentRequestId) setError(nextError);
    } finally {
      if (requestId.current === currentRequestId) setLoading(false);
    }
  }, [brand, category, lifecycleStatus, page, query]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const updateFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
  };

  const items = payload?.items || [];
  const total = payload?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / (payload?.page_size || PAGE_SIZE)));

  return (
    <Box className="catalog-product-list" aria-label="Catalog products">
      <HStack justify="space-between" gap={3} mb={4} align="start">
        <Box>
          <Text className="section-kicker">Products</Text>
          <Text as="h2" className="studio-column-title">Catalog</Text>
        </Box>
        <Button type="button" size="sm" className="secondary-button" onClick={load} aria-label="Refresh catalog products">
          <FiRefreshCw />
          Refresh
        </Button>
      </HStack>

      <VStack align="stretch" gap={3} mb={4}>
        <Box className="catalog-search-field">
          <FiSearch aria-hidden="true" />
          <Input
            aria-label="Search catalog products"
            value={query}
            onChange={updateFilter(setQuery)}
            placeholder="Search title or brand"
          />
        </Box>
        <HStack gap={3} align="stretch" flexWrap="wrap">
          <NativeSelect.Root flex="1">
            <NativeSelect.Field
              aria-label="Lifecycle status"
              value={lifecycleStatus}
              onChange={updateFilter(setLifecycleStatus)}
              className="native-select"
            >
              <option value="">All states</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Input flex="1 1 120px" aria-label="Filter by category" value={category} onChange={updateFilter(setCategory)} placeholder="Category" />
          <Input flex="1 1 120px" aria-label="Filter by brand" value={brand} onChange={updateFilter(setBrand)} placeholder="Brand" />
        </HStack>
      </VStack>

      {loading ? <LoadingState label="Loading managed products" /> : null}
      {!loading && error ? <ErrorState title="Catalog products unavailable" onRetry={load} /> : null}
      {!loading && !error && !items.length ? (
        <EmptyState title="No managed products" message="Adjust the search or lifecycle filters." />
      ) : null}
      {!loading && !error && items.length ? (
        <VStack align="stretch" gap={2} className="catalog-product-results">
          {items.map((item) => (
            <Button
              key={item.product_id}
              type="button"
              variant="ghost"
              className={`catalog-product-row ${selectedProductId === item.product_id ? "selected" : ""}`}
              aria-pressed={selectedProductId === item.product_id}
              onClick={() => onSelect(item.product_id)}
            >
              <Box minW={0} textAlign="left">
                <Text className="catalog-product-row-title">{item.title}</Text>
                <Text className="catalog-product-row-meta">{item.brand} · {titleize(item.category)}</Text>
              </Box>
              <VStack gap={1} align="end">
                <Badge className={`lifecycle-badge ${item.lifecycle_status}`}>{item.lifecycle_status}</Badge>
                {item.has_draft ? <Badge className="draft-badge">Draft v{item.current_draft_version}</Badge> : null}
              </VStack>
            </Button>
          ))}
        </VStack>
      ) : null}

      {!loading && !error && total ? (
        <HStack justify="space-between" mt={4} className="catalog-list-pagination">
          <Text className="muted-text">Page {page} of {totalPages} · {total} products</Text>
          <HStack gap={2}>
            <Button type="button" size="sm" className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <FiChevronLeft /> Previous
            </Button>
            <Button type="button" size="sm" className="secondary-button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Next <FiChevronRight />
            </Button>
          </HStack>
        </HStack>
      ) : null}
    </Box>
  );
}
