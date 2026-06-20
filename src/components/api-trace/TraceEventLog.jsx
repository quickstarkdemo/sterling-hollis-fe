import { Badge, Box, Text } from "@chakra-ui/react";

import { formatTraceTime } from "../../utils/apiTraceProjection";

export default function TraceEventLog({ trace, events = trace?.events || [], selection, onSelect }) {
  const ordered = [...events].sort((left, right) => Number(left.sequence) - Number(right.sequence));
  if (!ordered.length) return <Text className="api-trace-empty">Waiting for trace events.</Text>;
  return (
    <Box className="trace-event-log" role="listbox" aria-label="Trace event log">
      {ordered.map((event) => {
        const selected = selection?.kind === "event" && selection.id === event.event_id;
        const related = selection?.kind === "span" && selection.id === event.span_id;
        return (
          <button
            type="button"
            role="option"
            key={event.event_id}
            className={`trace-event-row${selected ? " selected" : related ? " related" : ""}`}
            aria-selected={selected}
            data-related={related ? "true" : "false"}
            onClick={() => onSelect({ kind: "event", id: event.event_id })}
          >
            <span className="trace-event-sequence">{String(event.sequence).padStart(2, "0")}</span>
            <span className="trace-event-copy">
              <strong>{event.name}</strong>
              <small>{event.event_type} · {formatTraceTime(event.occurred_at)}</small>
            </span>
            {event.status ? <Badge className={`api-trace-state ${event.status}`}>{event.status}</Badge> : null}
          </button>
        );
      })}
    </Box>
  );
}
