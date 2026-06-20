import { sanitizeTraceValue } from "./apiTraceProjection";

function timestamp(value) {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function spanEnd(span, start) {
  const completed = timestamp(span.completed_at);
  if (completed !== null && completed >= start) return completed;
  return start + Math.max(0, Number(span.duration_ms) || 0);
}

export function createReplaySnapshot(trace) {
  if (!trace) return null;
  const projection = sanitizeTraceValue(trace);
  const candidateStarts = [
    timestamp(projection.started_at),
    ...(projection.spans || []).map((span) => timestamp(span.started_at)),
    ...(projection.events || []).map((event) => timestamp(event.occurred_at)),
  ].filter((value) => value !== null);
  const origin = candidateStarts.length ? Math.min(...candidateStarts) : 0;
  const candidateEnds = [origin + Math.max(0, Number(projection.duration_ms) || 0)];
  (projection.spans || []).forEach((span) => {
    const start = timestamp(span.started_at) ?? origin;
    candidateEnds.push(spanEnd(span, start));
  });
  (projection.events || []).forEach((event) => candidateEnds.push(timestamp(event.occurred_at) ?? origin));
  const durationMs = Math.max(1, Math.max(...candidateEnds) - origin);
  return deepFreeze({ durationMs, origin, projection });
}

function offsetFrom(snapshot, value) {
  return Math.max(0, (timestamp(value) ?? snapshot.origin) - snapshot.origin);
}

export function buildReplayProjection(snapshot, cursorMs) {
  if (!snapshot) return null;
  const cursor = Math.max(0, Math.min(snapshot.durationMs, Number(cursorMs) || 0));
  const source = snapshot.projection;
  const spans = (source.spans || []).flatMap((span) => {
    const start = timestamp(span.started_at) ?? snapshot.origin;
    const startOffset = Math.max(0, start - snapshot.origin);
    if (startOffset > cursor) return [];
    const endOffset = Math.max(startOffset, spanEnd(span, start) - snapshot.origin);
    const complete = cursor >= endOffset;
    return [{
      ...span,
      completed_at: complete ? span.completed_at : null,
      duration_ms: complete ? span.duration_ms : Math.max(0, cursor - startOffset),
      status: complete ? span.status : "running",
    }];
  });
  const visibleSpanIds = new Set(spans.map((span) => span.span_id));
  const completedSpanIds = new Set(spans.filter((span) => span.status !== "running").map((span) => span.span_id));
  const events = (source.events || []).filter((event) => offsetFrom(snapshot, event.occurred_at) <= cursor);
  const links = (source.links || []).filter((link) => {
    if (!visibleSpanIds.has(link.span_id)) return false;
    if (link.linked_trace_id !== source.trace_id || !link.linked_span_id) return true;
    return visibleSpanIds.has(link.linked_span_id);
  });
  const artifacts = (source.artifacts || []).filter((artifact) => (
    !artifact.span_id || completedSpanIds.has(artifact.span_id)
  ));
  const complete = cursor >= snapshot.durationMs;
  return {
    ...source,
    artifacts,
    completed_at: complete ? source.completed_at : null,
    duration_ms: complete ? source.duration_ms : cursor,
    events,
    links,
    spans,
    status: complete ? source.status : "replaying",
  };
}
