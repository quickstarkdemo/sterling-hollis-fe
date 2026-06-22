import { Badge, Box, SimpleGrid, Text } from "@chakra-ui/react";

import SanitizedJsonViewer from "../admin/SanitizedJsonViewer";
import { formatTraceDuration, traceSelectionValue } from "../../utils/apiTraceProjection";
import { normalizeCapabilityDiagnostic } from "../../utils/capabilityDiagnostics";

function selectionLabel(selection) {
  if (!selection || selection.kind === "trace") return "Trace";
  return selection.kind.charAt(0).toUpperCase() + selection.kind.slice(1);
}

export default function TraceInspector({ trace, selection }) {
  if (!trace) return <Text className="api-trace-empty">Select a trace to inspect its projection.</Text>;
  const value = traceSelectionValue(trace, selection) || trace;
  const status = value.status || trace.status || "unknown";
  const attributes = value.attributes || {};
  const diagnostic = normalizeCapabilityDiagnostic(value, {
    operation: value.operation || trace.surface,
    status,
    surface: trace.surface,
  });
  return (
    <Box className="trace-inspector">
      <Box className="trace-inspector-heading">
        <Text className="section-kicker">{selectionLabel(selection)} inspector</Text>
        <Text className="panel-title">{value.name || trace.name}</Text>
        <Badge className={`api-trace-state ${status}`}>{status}</Badge>
      </Box>
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap={3} className="trace-inspector-metadata">
        <Box><Text className="filter-label">Operation</Text><Text>{value.operation || trace.surface}</Text></Box>
        <Box><Text className="filter-label">Duration</Text><Text>{formatTraceDuration(value.duration_ms)}</Text></Box>
        <Box><Text className="filter-label">Service</Text><Text>{value.service || "Browser / API"}</Text></Box>
        <Box><Text className="filter-label">Identifier</Text><Text className="trace-mono">{value.span_id || value.event_id || value.artifact_id || trace.trace_id}</Text></Box>
        {diagnostic.capabilityId ? <Box><Text className="filter-label">Capability</Text><Text>{diagnostic.label}</Text></Box> : null}
        {diagnostic.surface ? <Box><Text className="filter-label">Surface</Text><Text>{diagnostic.surface}</Text></Box> : null}
      </SimpleGrid>
      {trace.payload_expired ? (
        <Box className="api-trace-notice metadata-only">Detailed payloads have expired. Timing and metadata remain available.</Box>
      ) : null}
      {Object.keys(trace.truncation || {}).length ? (
        <Box className="api-trace-notice partial">The server truncated fields in this projection.</Box>
      ) : null}
      <SanitizedJsonViewer label="Full attributes" value={attributes} maxChars={Infinity} raw />
    </Box>
  );
}
