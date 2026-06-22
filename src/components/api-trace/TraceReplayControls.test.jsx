import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import useTraceReplay from "../../hooks/useTraceReplay";
import { buildReplayProjection, createReplaySnapshot } from "../../utils/apiTraceReplay";
import TraceReplayControls from "./TraceReplayControls";

const trace = {
  trace_id: "trace-replay",
  name: "Generate draft",
  surface: "catalog-studio",
  status: "completed",
  started_at: "2026-06-20T00:00:00.000Z",
  completed_at: "2026-06-20T00:00:02.000Z",
  duration_ms: 2000,
  attributes: { nested: { authorization: "Bearer secret" } },
  spans: [
    { span_id: "root", parent_span_id: null, name: "Root", status: "completed", started_at: "2026-06-20T00:00:00.000Z", completed_at: "2026-06-20T00:00:02.000Z", duration_ms: 2000, attributes: {} },
    { span_id: "child", parent_span_id: "root", name: "Child", status: "completed", started_at: "2026-06-20T00:00:00.500Z", completed_at: "2026-06-20T00:00:01.500Z", duration_ms: 1000, attributes: {} },
  ],
  events: [
    { event_id: "event-0", span_id: "root", sequence: 0, occurred_at: "2026-06-20T00:00:00.000Z" },
    { event_id: "event-1", span_id: "child", sequence: 1, occurred_at: "2026-06-20T00:00:00.700Z" },
  ],
  artifacts: [{ artifact_id: "artifact-1", span_id: "child", name: "Draft" }],
  links: [],
};

describe("replay projection", () => {
  it("reveals one immutable full snapshot by recorded offsets", () => {
    const snapshot = createReplaySnapshot(trace);
    trace.attributes.nested.authorization = "changed after snapshot";
    expect(Object.isFrozen(snapshot.projection.spans[0])).toBe(true);
    expect(snapshot.projection.attributes.nested.authorization).toBe("Bearer secret");

    const initial = buildReplayProjection(snapshot, 0);
    expect(initial.spans.map((span) => span.span_id)).toEqual(["root"]);
    expect(initial.spans[0].status).toBe("running");
    expect(initial.events.map((event) => event.event_id)).toEqual(["event-0"]);

    const middle = buildReplayProjection(snapshot, 800);
    expect(middle.spans.map((span) => span.span_id)).toEqual(["root", "child"]);
    expect(middle.events.map((event) => event.event_id)).toEqual(["event-0", "event-1"]);
    expect(middle.artifacts).toEqual([]);

    const afterChild = buildReplayProjection(snapshot, 1600);
    expect(afterChild.spans.find((span) => span.span_id === "child")?.status).toBe("completed");
    expect(afterChild.artifacts.map((artifact) => artifact.artifact_id)).toEqual(["artifact-1"]);
    expect(buildReplayProjection(snapshot, 2000).status).toBe("completed");
  });
});

describe("useTraceReplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("supports pause, resume, speed, scrub, restart, completion, and stop without network calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useTraceReplay(trace));

    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    expect(result.current.playing).toBe(true);
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.cursorMs).toBe(200);
    expect(result.current.activeItem).toEqual(expect.objectContaining({ kind: "event", id: "event-0" }));

    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.cursorMs).toBe(200);

    act(() => result.current.setSpeed(2));
    act(() => result.current.resume());
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.cursorMs).toBe(760);
    expect(result.current.activeItem).toEqual(expect.objectContaining({ kind: "event", id: "event-1" }));

    act(() => result.current.seek(1900));
    expect(result.current.playing).toBe(false);
    act(() => result.current.resume());
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.completed).toBe(true);
    expect(result.current.playing).toBe(false);

    act(() => result.current.restart());
    expect(result.current.cursorMs).toBe(0);
    expect(result.current.playing).toBe(true);
    act(() => result.current.stop());
    expect(result.current.active).toBe(false);
    expect(result.current.projection).toBe(trace);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("TraceReplayControls", () => {
  it("wires replay actions and exposes an accessible scrubber", () => {
    const replay = {
      active: true,
      activeItem: { kind: "span", id: "child", label: "Child", status: "running" },
      completed: false,
      cursorMs: 500,
      durationMs: 2000,
      playing: false,
      speed: 0.5,
      pause: vi.fn(),
      restart: vi.fn(),
      resume: vi.fn(),
      seek: vi.fn(),
      setSpeed: vi.fn(),
      stop: vi.fn(),
    };
    renderWithProviders(<TraceReplayControls replay={replay} />);

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "1200" } });
    expect(screen.getByText("Child")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1x" }));
    expect(replay.resume).toHaveBeenCalled();
    expect(replay.seek).toHaveBeenCalledWith("1200");
    expect(replay.setSpeed).toHaveBeenCalledWith(1);
  });
});
