import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { sanitizedTraceJson } from "../../utils/apiTraceProjection";

export default function SanitizedJsonViewer({ label, value, maxChars = 6000 }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const resetTimer = useRef(null);
  const projection = useMemo(() => sanitizedTraceJson(value, maxChars), [maxChars, value]);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(projection.text);
      setCopied(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <Box className="sanitized-json-viewer">
      <HStack justify="space-between" gap={3} mb={2}>
        <Text className="filter-label">{label}</Text>
        <Button type="button" size="xs" variant="ghost" className="text-button" onClick={copy}>
          {copied ? <FiCheck /> : <FiCopy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </HStack>
      <Box as="pre" className="sanitized-json-code" data-truncated={projection.truncated ? "true" : "false"}>
        {projection.text}
      </Box>
      {copyFailed ? <Text className="field-error">Clipboard access is unavailable.</Text> : null}
    </Box>
  );
}
