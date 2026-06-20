import { Badge, Box, Text } from "@chakra-ui/react";

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "Size not reported";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export default function TraceArtifactViewer({ artifacts = [], selection, onSelect }) {
  if (!artifacts.length) return <Text className="api-trace-empty">No artifact metadata is attached to this trace.</Text>;
  return (
    <Box className="trace-artifact-grid" role="listbox" aria-label="Trace artifacts">
      {artifacts.map((artifact) => {
        const selected = selection?.kind === "artifact" && selection.id === artifact.artifact_id;
        return (
          <button
            type="button"
            role="option"
            key={artifact.artifact_id}
            className={`trace-artifact-card${selected ? " selected" : ""}`}
            aria-selected={selected}
            onClick={() => onSelect({ kind: "artifact", id: artifact.artifact_id })}
          >
            <Badge className="api-trace-artifact-type">{artifact.artifact_type}</Badge>
            <strong>{artifact.name}</strong>
            <small>{artifact.media_type || "Metadata"} · {formatBytes(artifact.size_bytes)}</small>
          </button>
        );
      })}
    </Box>
  );
}
