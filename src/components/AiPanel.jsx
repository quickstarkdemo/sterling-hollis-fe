import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import { FiCpu, FiLayers, FiRadio } from "react-icons/fi";

export default function AiPanel({
  title = "AI recommendation signal",
  strategy,
  reasons = [],
  showDefaultTrace = true,
  children,
}) {
  return (
    <Box className="ai-panel">
      <HStack justify="space-between" align="start" gap={4}>
        <HStack align="start" gap={3}>
          <Box className="ai-icon">
            <FiCpu />
          </Box>
          <Box>
            <Text className="panel-title">{title}</Text>
            <Text className="muted-text">Backend-ranked catalog intelligence</Text>
          </Box>
        </HStack>
        {strategy ? <Badge className="ai-badge">{strategy.replace(/_/g, " ")}</Badge> : null}
      </HStack>
      {reasons.length ? (
        <VStack align="stretch" gap={2} mt={5}>
          {reasons.slice(0, 3).map((reason) => (
            <HStack key={reason} className="trace-row">
              <FiRadio />
              <Text>{reason}</Text>
            </HStack>
          ))}
        </VStack>
      ) : showDefaultTrace ? (
        <HStack className="trace-row" mt={5}>
          <FiLayers />
          <Text>Recommendations are resolved by the product API.</Text>
        </HStack>
      ) : null}
      {children}
    </Box>
  );
}
