const SENSITIVE_KEY = /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|credential|cookie|session|reasoning|chain[_-]?of[_-]?thought|raw[_-]?prompt)/i;

export function sanitizeTraceValue(value, seen = new WeakSet(), depth = 0) {
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeTraceValue(item, seen, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeTraceValue(item, seen, depth + 1),
    ]),
  );
}

export function sanitizedTraceJson(value, maxChars = 60_000) {
  const serialized = JSON.stringify(sanitizeTraceValue(value ?? {}), null, 2);
  if (serialized.length <= maxChars) return { text: serialized, truncated: false };
  return { text: `${serialized.slice(0, maxChars)}\n… [TRUNCATED]`, truncated: true };
}

export function formatTraceDuration(durationMs) {
  if (durationMs === null || durationMs === undefined || durationMs === "") return "In progress";
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) return "In progress";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
}

export function formatTraceTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function orderTraceSpans(spans = []) {
  return [...spans].sort((left, right) => {
    const time = new Date(left.started_at).getTime() - new Date(right.started_at).getTime();
    if (Number.isFinite(time) && time !== 0) return time;
    return String(left.span_id).localeCompare(String(right.span_id));
  });
}

export function buildWaterfallRows(trace) {
  const spans = orderTraceSpans(trace?.spans);
  if (!spans.length) return [];
  const starts = spans.map((span) => new Date(span.started_at).getTime()).filter(Number.isFinite);
  const ends = spans.map((span) => {
    const started = new Date(span.started_at).getTime();
    const completed = new Date(span.completed_at).getTime();
    if (Number.isFinite(completed) && completed >= started) return completed;
    const duration = Math.max(0, Number(span.duration_ms) || 0);
    return started + duration;
  }).filter(Number.isFinite);
  const origin = Math.min(...starts);
  const finish = Math.max(origin + 1, ...ends);
  const range = Math.max(1, finish - origin);
  const spanMap = new Map(spans.map((span) => [span.span_id, span]));
  const depthFor = (span) => {
    let depth = 0;
    let parent = spanMap.get(span.parent_span_id);
    const visited = new Set([span.span_id]);
    while (parent && !visited.has(parent.span_id) && depth < 8) {
      visited.add(parent.span_id);
      depth += 1;
      parent = spanMap.get(parent.parent_span_id);
    }
    return depth;
  };
  return spans.map((span) => {
    const started = new Date(span.started_at).getTime();
    const completed = new Date(span.completed_at).getTime();
    const duration = Math.max(
      0,
      Number.isFinite(Number(span.duration_ms))
        ? Number(span.duration_ms)
        : Number.isFinite(completed) && completed >= started
          ? completed - started
          : 0,
    );
    return {
      ...span,
      depth: depthFor(span),
      offsetPercent: Math.max(0, Math.min(100, ((started - origin) / range) * 100)),
      widthPercent: Math.max(0.8, Math.min(100, (duration / range) * 100)),
    };
  });
}

export function mergeTraceEvents(current = [], additions = []) {
  const events = new Map(current.map((event) => [event.event_id, event]));
  additions.forEach((event) => events.set(event.event_id, event));
  return [...events.values()].sort((left, right) => {
    const sequence = Number(left.sequence) - Number(right.sequence);
    if (Number.isFinite(sequence) && sequence !== 0) return sequence;
    return String(left.event_id).localeCompare(String(right.event_id));
  });
}

export function traceSelectionValue(trace, selection) {
  if (!trace || !selection) return trace;
  if (selection.kind === "span") return trace.spans?.find((item) => item.span_id === selection.id) || null;
  if (selection.kind === "event") return trace.events?.find((item) => item.event_id === selection.id) || null;
  if (selection.kind === "artifact") return trace.artifacts?.find((item) => item.artifact_id === selection.id) || null;
  return trace;
}

export function traceSelectionSpanId(trace, selection) {
  if (selection?.kind === "span") return selection.id;
  if (selection?.kind === "event") return trace?.events?.find((item) => item.event_id === selection.id)?.span_id || "";
  if (selection?.kind === "artifact") return trace?.artifacts?.find((item) => item.artifact_id === selection.id)?.span_id || "";
  return "";
}
