import { Box, Text, VStack } from "@chakra-ui/react";

export default function RealtimeTranscript({ entries = [], presenterPartial = "", assistantPartial = "" }) {
  const hasTranscript = entries.length || presenterPartial || assistantPartial;

  return (
    <Box className="realtime-transcript" aria-label="Voice transcript" aria-live="polite">
      <Text className="filter-label">Live transcript</Text>
      {!hasTranscript ? <Text className="muted-text">Speech will appear here while voice is active.</Text> : null}
      <VStack align="stretch" gap={2} mt={2}>
        {entries.map((entry) => (
          <Box key={entry.id} className={`realtime-transcript-entry ${entry.role}`}>
            <Text className="filter-label">{entry.role === "presenter" ? "You" : "Assistant"}</Text>
            <Text>{entry.text}</Text>
          </Box>
        ))}
        {presenterPartial ? (
          <Box className="realtime-transcript-entry presenter partial">
            <Text className="filter-label">You · listening</Text>
            <Text>{presenterPartial}</Text>
          </Box>
        ) : null}
        {assistantPartial ? (
          <Box className="realtime-transcript-entry assistant partial">
            <Text className="filter-label">Assistant · speaking</Text>
            <Text>{assistantPartial}</Text>
          </Box>
        ) : null}
      </VStack>
    </Box>
  );
}
