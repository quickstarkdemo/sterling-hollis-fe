import { Box, Button, Container, Flex, Text } from "@chakra-ui/react";
import { FiCode, FiPlus } from "react-icons/fi";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDeveloperLens } from "../components/DeveloperLensContext";
import { useCatalogStudioAccess } from "../components/CatalogStudioAccessContext";
import CatalogProductList from "../components/admin/CatalogProductList";
import ProductWorkbench from "../components/admin/ProductWorkbench";
import { getAdminCatalogReferences } from "../utils/apiClient";

export default function CatalogStudioPage() {
  const { enabled: developerToolsEnabled, toggle } = useDeveloperLens();
  const { session } = useCatalogStudioAccess();
  const [selectedProductId, setSelectedProductId] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const [references, setReferences] = useState(null);
  const [referencesStatus, setReferencesStatus] = useState("idle");
  const loadedReferenceVersion = useRef(0);
  const authoringSchemaVersion = Number(session?.capabilities?.catalog?.authoring_schema_version || 1);

  const loadReferences = useCallback(async () => {
    if (authoringSchemaVersion < 2) return;
    setReferencesStatus("loading");
    try {
      setReferences(await getAdminCatalogReferences());
      setReferencesStatus("ready");
    } catch {
      setReferencesStatus("error");
    }
  }, [authoringSchemaVersion]);

  useEffect(() => {
    if (authoringSchemaVersion < 2 || loadedReferenceVersion.current === authoringSchemaVersion) return;
    loadedReferenceVersion.current = authoringSchemaVersion;
    loadReferences();
  }, [authoringSchemaVersion, loadReferences]);

  const brandAdded = useCallback((brand) => {
    setReferences((current) => ({
      ...(current || { stores: [], categories: [], availability: [] }),
      brands: [...(current?.brands || []).filter((item) => item.id !== brand.id), brand]
        .sort((left, right) => left.name.localeCompare(right.name)),
    }));
    setReferencesStatus("ready");
  }, []);

  const selectProduct = useCallback((productId) => {
    if (productId === selectedProductId) return;
    if (editorDirty && !window.confirm("Discard unsaved changes and open another product?")) return;
    setSelectedProductId(productId);
    setEditorDirty(false);
  }, [editorDirty, selectedProductId]);

  const catalogChanged = useCallback(() => {
    setCatalogRefreshKey((current) => current + 1);
  }, []);

  const createProduct = useCallback(() => {
    if (!selectedProductId) return;
    if (editorDirty && !window.confirm("Discard unsaved changes and start a new product?")) return;
    setSelectedProductId("");
    setEditorDirty(false);
  }, [editorDirty, selectedProductId]);

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
          <Flex align={{ base: "stretch", md: "center" }} justify="space-between" gap={6} direction={{ base: "column", md: "row" }}>
            <Box maxW="760px">
              <Text className="section-kicker">Catalog management</Text>
              <Text as="h1" className="page-title catalog-page-title">
                Product Catalog
              </Text>
              <Text className="hero-copy" mt={3}>
                Find products, edit shopper-facing details, manage media and inventory, then publish deliberate catalog changes.
              </Text>
            </Box>
          </Flex>
        </Container>
      </Box>

      <Container maxW="1440px" py={{ base: 6, md: 8 }}>
        <Box className="catalog-workbench-layout">
          <Box className="catalog-workbench-navigation">
            <Button type="button" className="primary-button catalog-new-product" onClick={createProduct} aria-pressed={!selectedProductId}>
              <FiPlus /> New product
            </Button>
            <CatalogProductList
              selectedProductId={selectedProductId}
              onSelect={selectProduct}
              refreshKey={catalogRefreshKey}
              authoringSchemaVersion={authoringSchemaVersion}
              referenceCategories={references?.categories}
            />
          </Box>
          <ProductWorkbench
            key={selectedProductId || "new-product"}
            activeProductId={selectedProductId}
            onDirtyChange={setEditorDirty}
            onCatalogChanged={catalogChanged}
            authoringSchemaVersion={authoringSchemaVersion}
            references={references}
            referencesStatus={referencesStatus}
            onRetryReferences={loadReferences}
            onBrandAdded={brandAdded}
          />
        </Box>
      </Container>

      <Box className="developer-tools-launcher">
        <Button
          type="button"
          className={developerToolsEnabled ? "developer-tools-button enabled" : "developer-tools-button"}
          aria-pressed={developerToolsEnabled}
          onClick={toggle}
        >
          <FiCode />
          {developerToolsEnabled ? "Hide Developer tools" : "Developer tools"}
        </Button>
      </Box>
    </Box>
  );
}
