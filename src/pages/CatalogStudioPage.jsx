import { Badge, Box, Button, Container, Flex, HStack, SimpleGrid, Text } from "@chakra-ui/react";
import { FiCode, FiEye } from "react-icons/fi";
import { useCallback, useEffect, useState } from "react";

import { useCatalogStudioAccess } from "../components/CatalogStudioAccessContext";
import { useDeveloperLens } from "../components/DeveloperLensContext";
import CatalogProductList from "../components/admin/CatalogProductList";
import ProductCreationWorkspace from "../components/admin/ProductCreationWorkspace";
import ProductEditor from "../components/admin/ProductEditor";

const capabilityLabels = {
  responses: "Responses",
  moderation: "Moderation",
  image_generation: "Image generation",
  realtime: "Realtime voice",
  worker_storage: "Worker storage",
  catalog: "Catalog",
};

export default function CatalogStudioPage() {
  const { session } = useCatalogStudioAccess();
  const { enabled: developerLensEnabled, toggle } = useDeveloperLens();
  const capabilities = session?.capabilities || {};
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
                A protected production workspace for product drafts, generated imagery, review, and publication.
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

      <Container maxW="1440px" py={{ base: 8, md: 10 }}>
        <Box className="studio-readiness-panel studio-readiness-compact" mb={8}>
            <HStack justify="space-between" align="start" gap={4} mb={5}>
              <Box>
                <Text className="section-kicker">System readiness</Text>
                <Text as="h2" className="section-title studio-panel-title">
                  Connected capabilities
                </Text>
              </Box>
              <Badge className="ready-badge">Authorized</Badge>
            </HStack>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap={3}>
              {Object.entries(capabilityLabels).map(([key, label]) => {
                const configured = Boolean(capabilities[key]?.configured);
                return (
                  <Flex key={key} className="studio-capability-row" justify="space-between" align="center" gap={3}>
                    <Text>{label}</Text>
                    <Badge className={configured ? "ready-badge" : "blocked-badge"}>
                      {configured ? "Ready" : "Unavailable"}
                    </Badge>
                  </Flex>
                );
              })}
            </SimpleGrid>

            {developerLensEnabled ? (
              <Box className="developer-lens-detail" mt={5}>
                <HStack gap={2} mb={2}>
                  <FiCode />
                  <Text className="panel-title">Technical view</Text>
                </HStack>
                <Text className="muted-text">
                  Authorization resolved through <code>GET /api/admin/session</code>. Capability values report configuration only; provider credentials and raw configuration never reach the browser.
                </Text>
              </Box>
            ) : null}
        </Box>

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
