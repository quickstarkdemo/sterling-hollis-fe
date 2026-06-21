import { Badge, Box, Button, HStack, Input, NativeSelect, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiGrid, FiList, FiRefreshCw, FiSearch, FiX } from "react-icons/fi";

import { EmptyState, ErrorState, LoadingState } from "../StatusState";
import { getAdminCatalogProducts, getAdminCatalogProductsV2, getCategories } from "../../utils/apiClient";
import { titleize } from "../../utils/format";

const PAGE_SIZE = 12;
const VIEW_MODE_KEY = "sterling-hollis:catalog-studio:product-view-mode";

function preferredViewMode() {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "table" ? "table" : "grid";
  } catch {
    return "grid";
  }
}

function ProductStatusBadges({ item, align = "end" }) {
  return (
    <VStack gap={1} align={align}>
      <Badge className={`lifecycle-badge ${item.lifecycle_status}`}>{item.lifecycle_status}</Badge>
      {item.has_draft ? <Badge className="draft-badge">Draft v{item.current_draft_version}</Badge> : null}
    </VStack>
  );
}

function ProductGridResults({ items, selectedProductId, onSelect }) {
  return (
    <Box className="catalog-product-grid">
      {items.map((item) => (
        <Button
          key={item.product_id}
          type="button"
          variant="ghost"
          className={`catalog-product-card ${selectedProductId === item.product_id ? "selected" : ""}`}
          aria-pressed={selectedProductId === item.product_id}
          onClick={() => onSelect(item.product_id)}
        >
          <Box minW={0} textAlign="left">
            <Text className="catalog-product-row-title">{item.title}</Text>
            <Text className="catalog-product-row-meta">{item.brand}</Text>
            <Text className="catalog-product-card-category">{titleize(item.category)}</Text>
          </Box>
          <ProductStatusBadges item={item} />
        </Button>
      ))}
    </Box>
  );
}

function ProductTableResults({ items, selectedProductId, onSelect }) {
  return (
    <Box className="catalog-product-table-wrap">
      <Box as="table" className="catalog-product-table" aria-label="Catalog results table">
        <Box as="thead">
          <Box as="tr">
            <Box as="th" scope="col">Product</Box>
            <Box as="th" scope="col">Brand</Box>
            <Box as="th" scope="col">Category</Box>
            <Box as="th" scope="col">Status</Box>
          </Box>
        </Box>
        <Box as="tbody">
          {items.map((item) => (
            <Box as="tr" key={item.product_id} className={selectedProductId === item.product_id ? "selected" : ""}>
              <Box as="td">
                <Button
                  type="button"
                  variant="ghost"
                  className="catalog-product-table-action"
                  aria-pressed={selectedProductId === item.product_id}
                  onClick={() => onSelect(item.product_id)}
                >
                  Open {item.title}
                </Button>
              </Box>
              <Box as="td">{item.brand}</Box>
              <Box as="td">{titleize(item.category)}</Box>
              <Box as="td">
                <ProductStatusBadges item={item} align="start" />
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export default function CatalogProductList({
  selectedProductId,
  onSelect,
  refreshKey = 0,
  authoringSchemaVersion = 1,
  referenceCategories,
}) {
  const [query, setQuery] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const [brand, setBrand] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState(preferredViewMode);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setLoading(true);
    setError(null);
    try {
      const listProducts = authoringSchemaVersion >= 2
        ? getAdminCatalogProductsV2
        : getAdminCatalogProducts;
      const nextPayload = await listProducts({
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
  }, [authoringSchemaVersion, brand, category, lifecycleStatus, page, query]);

  const loadCategories = useCallback(async () => {
    try {
      const categoryPayload = await getCategories();
      setCategories(categoryPayload.categories || []);
    } catch {
      // Preserve the last successful option list when a manual refresh fails.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (authoringSchemaVersion >= 2) {
      setCategories(referenceCategories || []);
      return;
    }
    loadCategories();
  }, [authoringSchemaVersion, loadCategories, referenceCategories, refreshKey]);

  const refresh = () => {
    load();
    if (authoringSchemaVersion < 2) loadCategories();
  };

  const updateFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
  };

  const items = payload?.items || [];
  const total = payload?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / (payload?.page_size || PAGE_SIZE)));
  const hasFilters = Boolean(query || lifecycleStatus || category || brand);

  const clearFilters = () => {
    setQuery("");
    setLifecycleStatus("");
    setCategory("");
    setBrand("");
    setPage(1);
  };

  const changeViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // The selected mode is a preference, not a requirement for the catalog.
    }
  };

  return (
    <Box className="catalog-product-list" aria-label="Catalog products">
      <HStack justify="space-between" gap={3} mb={4} align="start" className="catalog-product-header">
        <Box>
          <Text className="section-kicker">Products</Text>
          <Text as="h2" className="studio-column-title">Product catalog</Text>
          <Text className="catalog-results-count">
            {loading && !payload ? "Loading products..." : `${total.toLocaleString()} ${total === 1 ? "product" : "products"}`}
          </Text>
        </Box>
        <HStack gap={2} className="catalog-product-toolbar">
          <Box className="catalog-view-switch" role="group" aria-label="Catalog view mode">
            <Button type="button" size="sm" aria-pressed={viewMode === "grid"} onClick={() => changeViewMode("grid")}>
              <FiGrid /> Grid view
            </Button>
            <Button type="button" size="sm" aria-pressed={viewMode === "table"} onClick={() => changeViewMode("table")}>
              <FiList /> Table view
            </Button>
          </Box>
          <Button type="button" size="sm" className="secondary-button" onClick={refresh} aria-label="Refresh catalog products">
            <FiRefreshCw />
            Refresh
          </Button>
        </HStack>
      </HStack>

      <VStack align="stretch" gap={3} mb={4}>
        <Text as="label" htmlFor="catalog-product-search" className="filter-label">Search products</Text>
        <Box className="catalog-search-field">
          <FiSearch aria-hidden="true" />
          <Input
            id="catalog-product-search"
            aria-label="Search catalog products"
            value={query}
            onChange={updateFilter(setQuery)}
            placeholder="Search title or brand"
          />
        </Box>
        <SimpleGrid columns={{ base: 1, sm: 2 }} gap={3} className="catalog-filter-grid">
          <Box className="catalog-filter-field">
            <Text as="label" htmlFor="catalog-lifecycle-filter" className="filter-label">State</Text>
            <NativeSelect.Root>
              <NativeSelect.Field
                id="catalog-lifecycle-filter"
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
          </Box>
          <Box className="catalog-filter-field">
            <Text as="label" htmlFor="catalog-category-filter" className="filter-label">Category</Text>
            <NativeSelect.Root>
              <NativeSelect.Field
                id="catalog-category-filter"
                aria-label="Filter by category"
                value={category}
                onChange={updateFilter(setCategory)}
                className="native-select"
              >
                <option value="">All categories</option>
                {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Box>
        </SimpleGrid>
        <Box className="catalog-filter-field">
          <Text as="label" htmlFor="catalog-brand-filter" className="filter-label">Brand</Text>
          <Input id="catalog-brand-filter" aria-label="Filter by brand" value={brand} onChange={updateFilter(setBrand)} placeholder="Any brand" />
        </Box>
        {hasFilters ? (
          <Button type="button" size="sm" variant="ghost" className="catalog-clear-filters" onClick={clearFilters}>
            <FiX /> Clear filters
          </Button>
        ) : null}
      </VStack>

      {loading ? <LoadingState label="Loading managed products" /> : null}
      {!loading && error ? <ErrorState title="Catalog products unavailable" onRetry={load} /> : null}
      {!loading && !error && !items.length ? (
        <EmptyState title="No managed products" message="Adjust the search or lifecycle filters." />
      ) : null}
      {!loading && !error && items.length ? (
        <Box className="catalog-product-results">
          {viewMode === "table" ? (
            <ProductTableResults items={items} selectedProductId={selectedProductId} onSelect={onSelect} />
          ) : (
            <ProductGridResults items={items} selectedProductId={selectedProductId} onSelect={onSelect} />
          )}
        </Box>
      ) : null}

      {!loading && !error && total ? (
        <HStack justify="space-between" mt={4} className="catalog-list-pagination">
          <Text className="muted-text">Page {page} of {totalPages} - {total} products</Text>
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
