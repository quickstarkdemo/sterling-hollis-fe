import { Badge, Box, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { FiCode } from "react-icons/fi";

import { useDeveloperLens } from "../DeveloperLensContext";
import SanitizedJsonViewer from "./SanitizedJsonViewer";

export default function DeveloperLens({ events = [] }) {
  const { enabled } = useDeveloperLens();
  if (!enabled) return null;

  const developerEvents = events.filter((event) => event.developer);

  return (
    <Box className="workflow-developer-lens" aria-label="Workflow developer lens">
      <HStack gap={2} mb={4}>
        <FiCode />
        <Box>
          <Text className="section-kicker">Developer lens</Text>
          <Text className="panel-title">Sanitized API metadata</Text>
        </Box>
      </HStack>
      {!developerEvents.length ? (
        <Text className="muted-text">No developer projections are available for this workflow yet.</Text>
      ) : (
        <VStack align="stretch" gap={4}>
          {developerEvents.map((event) => {
            const developer = event.developer || {};
            return (
              <Box key={event.id} className="developer-event-card">
                <HStack justify="space-between" gap={3} mb={3} flexWrap="wrap">
                  <Box>
                    <Text className="panel-title">{event.stage}</Text>
                    <Text className="muted-text">Sequence {event.sequence}</Text>
                  </Box>
                  <Badge className={`workflow-status ${event.status}`}>{event.status}</Badge>
                </HStack>
                <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap={3} className="developer-metadata-grid">
                  <Box><Text className="filter-label">Model</Text><Text>{developer.model || "Not reported"}</Text></Box>
                  <Box><Text className="filter-label">Request ID</Text><Text>{developer.request_id || "Not reported"}</Text></Box>
                  <Box><Text className="filter-label">Duration</Text><Text>{developer.duration_ms == null ? "Not reported" : `${developer.duration_ms} ms`}</Text></Box>
                  <Box><Text className="filter-label">Error code</Text><Text>{developer.error_code || "None"}</Text></Box>
                </SimpleGrid>
                {developer.payload_expired ? <Text className="catalog-action-hint">Detailed payload projections have expired.</Text> : null}
                <SimpleGrid columns={{ base: 1, xl: 2 }} gap={4} mt={4}>
                  <SanitizedJsonViewer label="Request projection" value={developer.request_payload || {}} />
                  <SanitizedJsonViewer label="Response projection" value={developer.response_payload || {}} />
                  <SanitizedJsonViewer label="Usage" value={developer.usage || {}} maxChars={3000} />
                  <SanitizedJsonViewer label="Moderation" value={developer.moderation || {}} maxChars={3000} />
                </SimpleGrid>
              </Box>
            );
          })}
        </VStack>
      )}
    </Box>
  );
}
