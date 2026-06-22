import {
  Box,
  Button,
  Container,
  HStack,
  Input,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { FiArrowRight, FiCamera, FiSearch, FiStar } from "react-icons/fi";
import { useEffect, useMemo, useState } from "react";

import AiPanel from "../components/AiPanel";
import CategoryRail from "../components/CategoryRail";
import { usePageChatContext } from "../components/ChatContext";
import ProductCard from "../components/ProductCard";
import ProductGrid from "../components/ProductGrid";
import { EmptyState, ErrorState, LoadingState } from "../components/StatusState";
import { getCatalog, getProductRecommendations, searchProducts } from "../utils/apiClient";
import { trackAction } from "../utils/datadog";
import { filterPlannedSearchResults, planProductSearch } from "../utils/searchQuery";

const searchSuggestions = ["satin", "camel", "silk", "shoes", "men's shoes"];

export default function HomePage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationStrategy, setRecommendationStrategy] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const chatContext = useMemo(
    () => ({
      page_type: "home",
    }),
    [],
  );
  usePageChatContext(chatContext);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogData, recData] = await Promise.all([
        getCatalog({ limit: 12, sort: "inventory_desc" }),
        getProductRecommendations({ top_k: 4 }),
      ]);
      setCatalog(catalogData);
      setRecommendations(recData.recommendations || []);
      setRecommendationStrategy(recData.strategy || "");
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runSearch = async (queryValue) => {
    const query = queryValue.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }
    setSearchTerm(query);
    setIsSearching(true);
    const searchPlan = planProductSearch(query, { limit: 12 });
    trackAction("product_search", {
      query,
      planned_query: searchPlan.query,
      category: searchPlan.category,
      gender: searchPlan.gender,
    });
    try {
      const results = await searchProducts(searchPlan.query, {
        limit: searchPlan.limit,
        category: searchPlan.category,
      });
      setSearchResults(filterPlannedSearchResults(results.items || [], searchPlan));
    } catch (err) {
      setError(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    runSearch(searchTerm);
  };

  if (loading) return <LoadingState />;
  if (error) {
    return (
      <Container maxW="1100px" py={16}>
        <ErrorState
          onRetry={load}
          message={`Check VITE_API_URL. Current browser target: ${import.meta.env.VITE_API_URL || "same-origin /api"}`}
        />
      </Container>
    );
  }

  const featured = catalog?.products || [];
  const categories = catalog?.categories || [];

  return (
    <Box>
      <Box className="hero-band">
        <Container maxW="1280px">
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap={{ base: 8, lg: 12 }} alignItems="center">
            <VStack align="stretch" gap={6}>
              <Box>
                <Text className="section-kicker">Retail demo storefront</Text>
                <Text as="h1" className="hero-title">
                  Curated pieces for every client, store, and occasion.
                </Text>
                <Text className="hero-copy">
                  Shop live assortment signals, store availability, and AI-assisted edits built for faster clienteling.
                </Text>
              </Box>

              <Box as="form" onSubmit={handleSearch} className="search-box">
                <FiSearch />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search satin, camel, silk, shoes..."
                  className="search-input"
                />
                <Button type="submit" className="primary-button" loading={isSearching}>
                  Search
                </Button>
              </Box>

              <HStack gap={2} flexWrap="wrap">
                {searchSuggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    size="xs"
                    variant="ghost"
                    className="suggestion-chip"
                    onClick={() => runSearch(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </HStack>

              <HStack gap={3} flexWrap="wrap">
                <Button as={RouterLink} to="/style-finder" className="secondary-button">
                  <FiCamera />
                  Style Finder
                </Button>
                <Button onClick={() => navigate("/category/womens_apparel")} variant="ghost" className="text-button">
                  Shop apparel
                  <FiArrowRight />
                </Button>
              </HStack>
            </VStack>

            <Box className="hero-showcase">
              {recommendations.slice(0, 2).map((row) => (
                <ProductCard key={row.product.id} product={row.product} compact />
              ))}
              {!recommendations.length && featured.slice(0, 2).map((product) => <ProductCard key={product.id} product={product} compact />)}
            </Box>
          </SimpleGrid>
        </Container>
      </Box>

      <Container maxW="1280px" py={10}>
        <CategoryRail categories={categories} />
      </Container>

      {searchResults ? (
        <Container maxW="1280px" pb={12}>
          <HStack justify="space-between" mb={5}>
            <Box>
              <Text className="section-kicker">Search results</Text>
              <Text className="section-title">Matches for “{searchTerm}”</Text>
              <Text className="muted-text">{searchResults.length} shown</Text>
            </Box>
            <Button variant="ghost" onClick={() => setSearchResults(null)} className="text-button">
              Clear
            </Button>
          </HStack>
          <ProductGrid
            products={searchResults}
            emptyMessage="No products matched that search. Try satin, camel, silk, shoes, men's shoes, or a category."
          />
        </Container>
      ) : null}

      <Container maxW="1280px" py={searchResults ? 0 : 8}>
        <HStack justify="space-between" align="end" mb={5}>
          <Box>
            <Text className="section-kicker">Catalog</Text>
            <Text className="section-title">Featured products</Text>
          </Box>
          <Button as={RouterLink} to="/category/womens_apparel" variant="ghost" className="text-button">
            Browse category
            <FiArrowRight />
          </Button>
        </HStack>
        <ProductGrid products={featured} />
      </Container>

      <Container maxW="1280px" py={12}>
        <AiPanel title="AI-ranked recommendations" strategy={recommendationStrategy}>
          {recommendations.length ? (
            <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap={4} mt={5}>
              {recommendations.map((row) => (
                <Box key={row.product.id} className="recommendation-card">
                  <HStack mb={3} className="recommendation-score">
                    <FiStar />
                    <Text>{Math.round((row.score || 0) * 100)} signal</Text>
                  </HStack>
                  <ProductCard product={row.product} compact />
                </Box>
              ))}
            </SimpleGrid>
          ) : (
            <EmptyState title="No recommendations returned" message="The backend responded, but no recommendation rows were available." />
          )}
        </AiPanel>
      </Container>
    </Box>
  );
}
