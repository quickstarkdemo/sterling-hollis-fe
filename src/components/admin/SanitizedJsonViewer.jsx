import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";

const SENSITIVE_KEY = /(authorization|api[_-]?key|token|secret|password|credential|reasoning|chain[_-]?of[_-]?thought|raw[_-]?prompt)/i;

function sanitize(value, seen = new WeakSet(), depth = 0) {
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, seen, depth + 1));

  return Object.fromEntries(
    Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(item, seen, depth + 1),
    ]),
  );
}

function sanitizedJson(value, maxChars = 6000) {
  const serialized = JSON.stringify(sanitize(value ?? {}), null, 2);
  if (serialized.length <= maxChars) return { text: serialized, truncated: false };
  return { text: `${serialized.slice(0, maxChars)}\n… [TRUNCATED]`, truncated: true };
}

export default function SanitizedJsonViewer({ label, value, maxChars = 6000 }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const resetTimer = useRef(null);
  const projection = useMemo(() => sanitizedJson(value, maxChars), [maxChars, value]);

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
