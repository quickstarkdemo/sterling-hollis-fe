import { describe, expect, it } from "vitest";

import {
  buildWaterfallRows,
  fullTraceValue,
  mergeTraceEvents,
  sanitizedTraceJson,
  traceJson,
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

  it("can render full trace values without redaction, object caps, or JSON truncation", () => {
    const cyclic = { safe: "visible" };
    cyclic.self = cyclic;
    const value = {
      access_token: "secret-value",
      nested: Array.from({ length: 105 }, (_, index) => ({ index })),
      cyclic,
    };

    const projection = traceJson(value, { sanitize: false, maxChars: Infinity });
    expect(projection.truncated).toBe(false);
    expect(projection.text).toContain("secret-value");
    expect(projection.text).toContain('"index": 104');
    expect(projection.text).toContain("[CIRCULAR]");
    expect(fullTraceValue(value).access_token).toBe("secret-value");
  });

  it("adds a visible conversation section while preserving the full trace payload", () => {
    const trace = {
      trace_id: "trace-1",
      spans: [{ span_id: "root" }],
      events: [
        {
          event_id: "turn-presenter",
          event_type: "conversation.turn",
          span_id: "root",
          occurred_at: "2026-06-20T00:00:01Z",
          attributes: {
            route: "catalog_realtime_voice",
            turn_id: "voice-turn-1",
            visible_messages: [
              {
                visible_message_id: "voice-turn-1:presenter",
                visible_role: "presenter",
                visible_text: "Which stores are low?",
                visible_created_at: "2026-06-20T00:00:01Z",
              },
            ],
          },
        },
        {
          event_id: "turn-assistant",
          event_type: "conversation.turn",
          span_id: "root",
          occurred_at: "2026-06-20T00:00:02Z",
          attributes: {
            route: "catalog_realtime_voice",
            selected_tool: "read_inventory_status",
            turn_id: "voice-turn-1",
            visible_messages: [
              {
                visible_message_id: "voice-turn-1:assistant",
                visible_role: "assistant",
                visible_text: "Dallas Downtown is low on stock.",
                visible_created_at: "2026-06-20T00:00:02Z",
              },
            ],
          },
        },
      ],
      artifacts: [],
    };

    const projection = fullTraceValue(trace);

    expect(projection.events).toHaveLength(2);
    expect(projection.visible_conversation).toMatchObject({
      schema_version: "sterling.visible_conversation.v1",
      trace_id: "trace-1",
      payload_state: "available",
      record_count: 1,
      message_count: 2,
    });
    expect(projection.visible_conversation.records[0]).toMatchObject({
      kind: "event",
      id: "turn-presenter",
      turn_id: "voice-turn-1",
      selected_tool: "read_inventory_status",
      messages: [
        { id: "voice-turn-1:presenter", role: "presenter", text: "Which stores are low?" },
        { id: "voice-turn-1:assistant", role: "assistant", text: "Dallas Downtown is low on stock." },
      ],
    });
  });

  it("keeps expired transcript details metadata-only in the visible conversation section", () => {
    const trace = {
      trace_id: "trace-expired",
      payload_expired: true,
      spans: [{ span_id: "root" }],
      events: [],
      artifacts: [
        {
          artifact_id: "artifact-chat",
          span_id: "root",
          artifact_type: "chat_transcript",
          attributes: {
            _retention: "expired",
            turn_id: "turn-private",
            visible_messages: [
              { visible_role: "user", visible_text: "private retained payload" },
            ],
          },
        },
      ],
    };

    const projection = fullTraceValue(trace);

    expect(projection.artifacts[0].attributes.visible_messages[0].visible_text).toBe("private retained payload");
    expect(projection.visible_conversation.records[0]).toMatchObject({
      id: "artifact-chat",
      payload_state: "metadata_only",
      turn_id: "turn-private",
      expired: true,
      message_count: 0,
      messages: [],
    });
    expect(JSON.stringify(projection.visible_conversation)).not.toContain("private retained payload");
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
