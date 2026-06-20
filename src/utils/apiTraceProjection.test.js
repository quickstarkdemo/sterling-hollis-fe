import { describe, expect, it } from "vitest";

import {
  buildWaterfallRows,
  mergeTraceEvents,
  sanitizedTraceJson,
} from "./apiTraceProjection";

describe("apiTraceProjection", () => {
  it("redacts adversarial secrets at nested depths before copy or export", () => {
    const projection = sanitizedTraceJson({
      safe: "visible",
      nested: [{ credentials: { access_token: "secret-value" } }],
      raw_prompt: "private prompt",
    });
    expect(projection.text).toContain("visible");
    expect(projection.text).toContain("[REDACTED]");
    expect(projection.text).not.toContain("secret-value");
    expect(projection.text).not.toContain("private prompt");
  });

  it("clamps negative, zero, and unknown waterfall durations", () => {
    const rows = buildWaterfallRows({ spans: [
      { span_id: "a", parent_span_id: null, started_at: "2026-06-20T00:00:02Z", completed_at: "2026-06-20T00:00:01Z", duration_ms: -4 },
      { span_id: "b", parent_span_id: "a", started_at: "2026-06-20T00:00:03Z", duration_ms: null },
    ] });
    expect(rows.every((row) => row.offsetPercent >= 0 && row.widthPercent > 0)).toBe(true);
  });

  it("deduplicates and sequence-orders late events", () => {
    expect(mergeTraceEvents(
      [{ event_id: "two", sequence: 2 }],
      [{ event_id: "one", sequence: 1 }, { event_id: "two", sequence: 2, status: "completed" }],
    )).toEqual([
      { event_id: "one", sequence: 1 },
      { event_id: "two", sequence: 2, status: "completed" },
    ]);
  });
});
