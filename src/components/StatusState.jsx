import { Box, Button, Spinner, Text, VStack } from "@chakra-ui/react";
import { FiRefreshCw, FiWifiOff } from "react-icons/fi";

export function LoadingState({ label = "Loading retail data" }) {
  return (
    <VStack className="status-state" gap={4}>
      <Spinner size="lg" color="saffron.500" />
      <Text>{label}</Text>
    </VStack>
  );
}

export function ErrorState({ title = "Backend unavailable", message, onRetry }) {
  return (
    <VStack className="status-state error-state" gap={4}>
      <Box className="status-icon">
        <FiWifiOff />
      </Box>
      <Box textAlign="center">
        <Text className="status-title">{title}</Text>
        <Text className="muted-text">{message || "The storefront could not reach the product API."}</Text>
      </Box>
      {onRetry ? (
        <Button onClick={onRetry} className="secondary-button">
          <FiRefreshCw />
          Retry
        </Button>
      ) : null}
    </VStack>
  );
}

export function EmptyState({ title = "Nothing here yet", message }) {
  return (
    <VStack className="status-state" gap={3}>
      <Text className="status-title">{title}</Text>
      <Text className="muted-text">{message}</Text>
    </VStack>
  );
}
