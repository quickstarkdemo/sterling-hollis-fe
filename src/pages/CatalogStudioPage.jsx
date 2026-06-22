import { Box, Button, Container, Flex, Text } from "@chakra-ui/react";
import { FiMessageSquare, FiPlus } from "react-icons/fi";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCatalogStudioAccess } from "../components/CatalogStudioAccessContext";
import CatalogProductList from "../components/admin/CatalogProductList";
import ProductWorkbench from "../components/admin/ProductWorkbench";
import { getAdminCatalogReferences } from "../utils/apiClient";

export default function CatalogStudioPage() {
  const { session } = useCatalogStudioAccess();
  const [selectedProductId, setSelectedProductId] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const [references, setReferences] = useState(null);
  const [referencesStatus, setReferencesStatus] = useState("idle");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
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
    setInspectorOpen(true);
  }, [editorDirty, selectedProductId]);

  const catalogChanged = useCallback(() => {
    setCatalogRefreshKey((current) => current + 1);
  }, []);

  const createProduct = useCallback(() => {
    if (editorDirty && !window.confirm("Discard unsaved changes and start a new product?")) return;
    setSelectedProductId("");
    setEditorDirty(false);
    setInspectorOpen(true);
  }, [editorDirty]);

  const openAssistant = useCallback(() => setAssistantOpen(true), []);

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
      <Container maxW="1440px" py={{ base: 4, md: 5 }} className="catalog-command-container">
        <Box className="catalog-command-header">
          <Box minW={0}>
            <Text className="section-kicker">Catalog management</Text>
            <Text as="h1" className="page-title catalog-page-title">
              Catalog Studio
            </Text>
            <Text className="muted-text catalog-command-copy">
              Search, edit, ask, review, and publish product data from one protected command center.
            </Text>
          </Box>
          <Flex gap={2} align="center" justify={{ base: "stretch", md: "end" }} wrap="wrap" className="catalog-command-actions">
            <Button type="button" className="secondary-button" onClick={openAssistant}>
              <FiMessageSquare /> Ask AI
            </Button>
            <Button type="button" className="primary-button" onClick={createProduct} aria-pressed={!selectedProductId}>
              <FiPlus /> New product
            </Button>
          </Flex>
        </Box>
        <Box className="catalog-workbench-layout">
          <Box className="catalog-workbench-navigation">
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
            assistantOpen={assistantOpen}
            onAssistantOpenChange={setAssistantOpen}
            inspectorOpen={inspectorOpen}
            onInspectorOpenChange={setInspectorOpen}
          />
        </Box>
      </Container>
    </Box>
  );
}
