import { Badge, Box, Button, Container, Flex, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { FiCode, FiEye, FiLock, FiShield } from "react-icons/fi";

import { useCatalogStudioAccess } from "../components/CatalogStudioAccessContext";
import { useDeveloperLens } from "../components/DeveloperLensContext";

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

      <Container maxW="1180px" py={{ base: 8, md: 12 }}>
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={8} alignItems="start">
          <VStack align="stretch" gap={5}>
            <Box>
              <Text className="section-kicker">Workspace</Text>
              <Text as="h2" className="section-title">
                Catalog operations
              </Text>
              <Text className="muted-text" mt={3}>
                The protected shell is ready. Product search, editing, and lifecycle actions arrive in the next catalog-management unit.
              </Text>
            </Box>
            <Box className="studio-assurance-row">
              <Box className="studio-assurance-icon">
                <FiLock />
              </Box>
              <Box>
                <Text className="panel-title">Server-authorized access</Text>
                <Text className="muted-text">
                  Clerk identifies the presenter; the backend independently decides who can use this workspace.
                </Text>
              </Box>
            </Box>
            <Box className="studio-assurance-row">
              <Box className="studio-assurance-icon">
                <FiShield />
              </Box>
              <Box>
                <Text className="panel-title">Published catalog stays separate</Text>
                <Text className="muted-text">
                  Draft work remains private until an administrator explicitly publishes it.
                </Text>
              </Box>
            </Box>
          </VStack>

          <Box className="studio-readiness-panel">
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
        </SimpleGrid>
      </Container>
    </Box>
  );
}
