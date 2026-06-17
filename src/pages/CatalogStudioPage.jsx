import { Box, Container, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";

import CatalogProductList from "../components/admin/CatalogProductList";
import ProductEditor from "../components/admin/ProductEditor";

export default function CatalogStudioPage() {
  const [selectedProductId, setSelectedProductId] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);

  const selectProduct = useCallback((productId) => {
    if (productId === selectedProductId) return;
    if (editorDirty && !window.confirm("Discard unsaved changes and open another product?")) return;
    setSelectedProductId(productId);
    setEditorDirty(false);
  }, [editorDirty, selectedProductId]);

  const catalogChanged = useCallback(() => {
    setCatalogRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!editorDirty) return undefined;
    const confirmInternalNavigation = (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link || link.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (window.confirm("Discard unsaved changes and leave Catalog Studio?")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", confirmInternalNavigation, true);
    return () => document.removeEventListener("click", confirmInternalNavigation, true);
  }, [editorDirty]);

  return (
    <Box className="catalog-studio-page">
      <Box className="catalog-studio-hero">
        <Container maxW="1180px">
          <Box maxW="760px">
            <Text className="section-kicker">Catalog Studio</Text>
            <Text as="h1" className="page-title">
              Build and manage the product catalog
            </Text>
            <Text className="hero-copy" mt={4}>
              Find a product, review its current state, and publish deliberate catalog changes.
            </Text>
          </Box>
        </Container>
      </Box>

      <Container maxW="1440px" py={{ base: 6, md: 8 }}>
        <Box className="catalog-management-layout">
          <CatalogProductList
            selectedProductId={selectedProductId}
            onSelect={selectProduct}
            refreshKey={catalogRefreshKey}
          />
          <Box minW={0}>
            <ProductEditor
              key={selectedProductId || "empty-editor"}
              productId={selectedProductId}
              onDirtyChange={setEditorDirty}
              onCatalogChanged={catalogChanged}
            />
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
