import { Box, Text } from "@chakra-ui/react";

import {
  buildWaterfallRows,
  formatTraceDuration,
  traceSelectionSpanId,
} from "../../utils/apiTraceProjection";

export default function TraceWaterfall({ trace, selection, onSelect }) {
  const rows = buildWaterfallRows(trace);
  const selectedSpanId = traceSelectionSpanId(trace, selection);
  if (!rows.length) return <Text className="api-trace-empty">No spans have been recorded yet.</Text>;

  return (
    <Box className="trace-waterfall" role="listbox" aria-label="Trace span waterfall">
      <Box className="trace-waterfall-axis" aria-hidden="true"><span>Start</span><span>End</span></Box>
      {rows.map((span) => {
        const selected = selectedSpanId === span.span_id;
        return (
          <button
            type="button"
            role="option"
            key={span.span_id}
            className={`trace-waterfall-row${selected ? " selected" : ""}`}
            aria-selected={selected}
            onClick={() => onSelect({ kind: "span", id: span.span_id })}
          >
            <span className="trace-waterfall-label" style={{ paddingInlineStart: `${span.depth * 12}px` }}>
              <strong>{span.name}</strong>
              <small>{span.service} · {formatTraceDuration(span.duration_ms)}</small>
            </span>
            <span className="trace-waterfall-track" aria-hidden="true">
              <span
                className={`trace-waterfall-bar ${span.status || "running"}`}
                style={{ left: `${span.offsetPercent}%`, width: `${span.widthPercent}%` }}
              />
            </span>
          </button>
        );
      })}
    </Box>
  );
}
