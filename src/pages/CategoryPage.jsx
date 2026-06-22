import { Box, Button, Container, HStack, Input, NativeSelect, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom";
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiFilter, FiRefreshCw, FiX } from "react-icons/fi";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePageChatContext } from "../components/ChatContext";
import ProductGrid from "../components/ProductGrid";
import { ErrorState, LoadingState } from "../components/StatusState";
import { getCategories, getProducts } from "../utils/apiClient";
import { titleize } from "../utils/format";

const PAGE_SIZE = 24;

const sortOptions = [
  ["relevance", "Relevance"],
  ["newest", "Newest"],
  ["price_asc", "Price ascending"],
  ["price_desc", "Price descending"],
  ["inventory_desc", "Inventory"],
];

const positiveInteger = (value, fallback = 1) => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default function CategoryPage() {
  const { category } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const sort = searchParams.get("sort") || "relevance";
  const page = positiveInteger(searchParams.get("page"));
  const brand = searchParams.get("brand") || "";
  const size = searchParams.get("size") || "";
  const color = searchParams.get("color") || "";
  const minPrice = searchParams.get("min_price") || "";
  const maxPrice = searchParams.get("max_price") || "";
  const inStockOnly = searchParams.get("in_stock_only") === "true";

  const chatContext = useMemo(
    () => ({
      page_type: "category",
      category,
    }),
    [category],
  );
  usePageChatContext(chatContext);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [categoryData, productData] = await Promise.all([
        getCategories(),
        getProducts({
          category,
          sort,
          brand,
          size,
          color,
          min_price: minPrice,
          max_price: maxPrice,
          in_stock_only: inStockOnly ? "true" : undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
      ]);
      setCategories(categoryData.categories || []);
      setPayload(productData);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [brand, category, color, inStockOnly, maxPrice, minPrice, page, size, sort]);

  useEffect(() => {
    load();
  }, [load]);

  const updateQuery = (updates, { resetPage = true } = {}) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "" || value === false) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });
    if (resetPage) next.set("page", "1");
    setSearchParams(next);
  };

  const updateSort = (event) => {
    updateQuery({ sort: event.target.value });
  };

  const updateFilter = (key) => (event) => {
    updateQuery({ [key]: event.target.value });
  };

  const updateStockFilter = (event) => {
    updateQuery({ in_stock_only: event.target.checked ? "true" : "" });
  };

  const clearFilters = () => {
    setSearchParams({ page: "1", sort });
  };

  const goToPage = (nextPage) => {
    updateQuery({ page: Math.max(1, nextPage) }, { resetPage: false });
  };

  const facetValues = (name, selectedValue = "") => {
    const values = payload?.facets?.find((facet) => facet.name === name)?.values || [];
    if (!selectedValue || values.some((item) => item.value === selectedValue)) return values;
    return [{ value: selectedValue, count: 0 }, ...values];
  };

  useEffect(() => {
    if (!payload?.total) return;
    const lastPage = Math.max(1, Math.ceil(payload.total / PAGE_SIZE));
    if (page <= lastPage) return;
    const next = new URLSearchParams(searchParams);
    next.set("page", String(lastPage));
    setSearchParams(next, { replace: true });
  }, [page, payload?.total, searchParams, setSearchParams]);

  if (loading) return <LoadingState label={`Loading ${titleize(category)}`} />;

  const items = payload?.items || [];
  const total = payload?.total || 0;
  const start = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const end = total ? Math.min((page - 1) * PAGE_SIZE + items.length, total) : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;
  const hasFilters = Boolean(brand || size || color || minPrice || maxPrice || inStockOnly);

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
          <Text className="muted-text">
            {total ? `Showing ${start}-${end} of ${total} catalog products` : "No products found"}
          </Text>
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

      {error ? (
        <ErrorState onRetry={load} />
      ) : (
        <Box className="category-browse-layout">
          <VStack as="aside" align="stretch" gap={5} className="category-sidebar">
            <Box>
              <HStack justify="space-between" mb={3}>
                <Text className="filter-heading">Categories</Text>
                <FiFilter />
              </HStack>
              <VStack align="stretch" gap={2}>
                {categories.map((item) => (
                  <RouterLink
                    key={item.id}
                    to={`/category/${item.id}`}
                    className={`sidebar-category-link ${item.id === category ? "active" : ""}`}
                  >
                    <Text className="sidebar-category-label">{item.label}</Text>
                    <Text className="sidebar-category-count">{item.product_count}</Text>
                  </RouterLink>
                ))}
              </VStack>
            </Box>

            <Box className="filter-panel">
              <HStack justify="space-between" align="center" mb={4}>
                <Text className="filter-heading">Filters</Text>
                {hasFilters ? (
                  <Button size="xs" variant="ghost" className="text-button" onClick={clearFilters}>
                    <FiX />
                    Clear
                  </Button>
                ) : null}
              </HStack>

              <VStack align="stretch" gap={4}>
                <Box>
                  <Text className="filter-label">Brand</Text>
                  <NativeSelect.Root>
                    <NativeSelect.Field value={brand} onChange={updateFilter("brand")} className="native-select">
                      <option value="">All brands</option>
                      {facetValues("brand", brand).map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.value} ({item.count})
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Box>

                <Box>
                  <Text className="filter-label">Size</Text>
                  <NativeSelect.Root>
                    <NativeSelect.Field value={size} onChange={updateFilter("size")} className="native-select">
                      <option value="">All sizes</option>
                      {facetValues("size", size).map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.value} ({item.count})
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Box>

                <Box>
                  <Text className="filter-label">Color</Text>
                  <NativeSelect.Root>
                    <NativeSelect.Field value={color} onChange={updateFilter("color")} className="native-select">
                      <option value="">All colors</option>
                      {facetValues("color", color).map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.value} ({item.count})
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Box>

                <SimpleGrid columns={2} gap={3}>
                  <Box>
                    <Text className="filter-label">Min price</Text>
                    <Input
                      type="number"
                      min="0"
                      value={minPrice}
                      onChange={updateFilter("min_price")}
                      className="filter-input"
                      placeholder="$0"
                    />
                  </Box>
                  <Box>
                    <Text className="filter-label">Max price</Text>
                    <Input
                      type="number"
                      min="0"
                      value={maxPrice}
                      onChange={updateFilter("max_price")}
                      className="filter-input"
                      placeholder="$5000"
                    />
                  </Box>
                </SimpleGrid>

                <Box as="label" className="checkbox-filter">
                  <input type="checkbox" checked={inStockOnly} onChange={updateStockFilter} />
                  <Text>In stock only</Text>
                </Box>
              </VStack>
            </Box>
          </VStack>

          <Box minW={0}>
            <ProductGrid
              products={items}
              emptyMessage={hasFilters ? "No products matched those filters. Clear filters or try a broader range." : "No products found in this category."}
            />

            <HStack className="pagination-bar" justify="space-between" gap={4} flexWrap="wrap">
              <Text className="muted-text">
                Page {Math.min(page, totalPages)} of {totalPages}
              </Text>
              <HStack gap={2}>
                <Button className="secondary-button" onClick={() => goToPage(page - 1)} disabled={!hasPrevious}>
                  <FiChevronLeft />
                  Previous
                </Button>
                <Button className="secondary-button" onClick={() => goToPage(page + 1)} disabled={!hasNext}>
                  Next
                  <FiChevronRight />
                </Button>
              </HStack>
            </HStack>
          </Box>
        </Box>
      )}
    </Container>
  );
}
