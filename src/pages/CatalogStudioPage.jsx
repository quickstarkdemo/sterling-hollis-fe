import { Box, Button, Container, Flex, HStack, Text } from "@chakra-ui/react";
import { FiCode, FiEye } from "react-icons/fi";
import { useCallback, useEffect, useState } from "react";

import { useDeveloperLens } from "../components/DeveloperLensContext";
import CatalogProductList from "../components/admin/CatalogProductList";
import ProductCreationWorkspace from "../components/admin/ProductCreationWorkspace";
import ProductEditor from "../components/admin/ProductEditor";

export default function CatalogStudioPage() {
  const { enabled: developerLensEnabled, toggle } = useDeveloperLens();
  const [selectedProductId, setSelectedProductId] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const [studioMode, setStudioMode] = useState("create");

  const selectProduct = useCallback((productId) => {
    if (productId === selectedProductId) return;
    if (editorDirty && !window.confirm("Discard unsaved changes and open another product?")) return;
    setSelectedProductId(productId);
    setEditorDirty(false);
  }, [editorDirty, selectedProductId]);

  const catalogChanged = useCallback(() => {
    setCatalogRefreshKey((current) => current + 1);
  }, []);

  const switchMode = useCallback((nextMode) => {
    if (nextMode === studioMode) return;
    if (editorDirty && !window.confirm("Discard unsaved changes and switch Catalog Studio modes?")) return;
    setEditorDirty(false);
    setStudioMode(nextMode);
  }, [editorDirty, studioMode]);

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
          <Flex align={{ base: "stretch", md: "end" }} justify="space-between" gap={6} direction={{ base: "column", md: "row" }}>
            <Box maxW="760px">
              <Text className="section-kicker">Catalog Studio</Text>
              <Text as="h1" className="page-title">
                Build and manage the product catalog
              </Text>
              <Text className="hero-copy" mt={4}>
                Find a product, review its current state, and publish deliberate catalog changes.
              </Text>
            </Box>
            <Button
              type="button"
              className={developerLensEnabled ? "developer-lens-toggle enabled" : "developer-lens-toggle"}
              aria-pressed={developerLensEnabled}
              onClick={toggle}
            >
              {developerLensEnabled ? <FiCode /> : <FiEye />}
              Developer lens {developerLensEnabled ? "on" : "off"}
            </Button>
          </Flex>
        </Container>
      </Box>

      <Container maxW="1440px" py={{ base: 6, md: 8 }}>
        <HStack className="studio-mode-switcher" gap={2} mb={6}>
          <Button type="button" className={studioMode === "create" ? "primary-button" : "secondary-button"} onClick={() => switchMode("create")}>Create with OpenAI</Button>
          <Button type="button" className={studioMode === "manage" ? "primary-button" : "secondary-button"} onClick={() => switchMode("manage")}>Manage catalog</Button>
        </HStack>

        {studioMode === "create" ? (
          <ProductCreationWorkspace onDirtyChange={setEditorDirty} onCatalogChanged={catalogChanged} />
        ) : (
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
        )}
      </Container>
    </Box>
  );
}
