import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import { FiCheckCircle, FiCircle, FiClock, FiXCircle } from "react-icons/fi";

const stages = [
  { capability: "realtime", label: "Realtime Voice", description: "Capture an optional voice instruction through a short-lived browser session." },
  { capability: "responses", label: "Responses", description: "Turn the instruction into structured catalog fields." },
  { capability: "moderation", label: "Moderation", description: "Apply the application-owned allow or block policy." },
  { capability: "image_generation", label: "Image Generation", description: "Create and review version-bound product imagery." },
  { capability: "catalog", label: "Catalog", description: "Persist the private normalized product draft." },
  { capability: "publication", label: "Publication", description: "Atomically promote the approved draft to the storefront." },
];

function statusIcon(status) {
  if (["succeeded", "completed"].includes(status)) return <FiCheckCircle />;
  if (["failed", "blocked"].includes(status)) return <FiXCircle />;
  if (["queued", "started", "running", "retrying"].includes(status)) return <FiClock />;
  return <FiCircle />;
}

export default function ApiStageTimeline({ events = [] }) {
  const latestByCapability = events.reduce((summary, event) => ({ ...summary, [event.capability]: event }), {});

  return (
    <VStack align="stretch" gap={0} className="api-stage-timeline" aria-label="OpenAI API stage timeline">
      {stages.map((stage) => {
        const event = latestByCapability[stage.capability];
        const status = event?.status || "pending";
        return (
          <Box key={stage.capability} className={`api-stage-row ${status}`}>
            <Box className="api-stage-icon">{statusIcon(status)}</Box>
            <Box minW={0}>
              <HStack gap={2} flexWrap="wrap">
                <Text className="panel-title">{stage.label}</Text>
                <Badge className={`workflow-status ${status}`}>{status}</Badge>
              </HStack>
              <Text className="muted-text">{event?.business_summary || stage.description}</Text>
            </Box>
          </Box>
        );
      })}
    </VStack>
  );
}
