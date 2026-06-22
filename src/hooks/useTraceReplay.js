import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildReplayProjection, createReplaySnapshot } from "../utils/apiTraceReplay";

const TICK_MS = 40;
const INITIAL_STATE = { active: false, completed: false, cursorMs: 0, playing: false, speed: 0.5 };

function timestamp(value) {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function itemOffset(snapshot, value) {
  return Math.max(0, (timestamp(value) ?? snapshot.origin) - snapshot.origin);
}

function activeReplayItem(snapshot, cursorMs) {
  if (!snapshot) return null;
  const cursor = Math.max(0, Math.min(snapshot.durationMs, Number(cursorMs) || 0));
  const projection = snapshot.projection;
  const candidates = [
    ...(projection.spans || []).map((span) => ({
      kind: "span",
      id: span.span_id,
      label: span.name,
      offset: itemOffset(snapshot, span.started_at),
      status: span.status,
    })),
    ...(projection.events || []).map((event) => ({
      kind: "event",
      id: event.event_id,
      label: event.name || event.event_type,
      offset: itemOffset(snapshot, event.occurred_at),
      status: event.status,
    })),
    ...(projection.artifacts || []).map((artifact) => ({
      kind: "artifact",
      id: artifact.artifact_id,
      label: artifact.name || artifact.artifact_type,
      offset: itemOffset(snapshot, artifact.created_at || artifact.updated_at || projection.completed_at),
      status: artifact.status || "available",
    })),
  ]
    .filter((item) => item.id && item.offset <= cursor)
    .sort((left, right) => {
      const offset = right.offset - left.offset;
      if (offset !== 0) return offset;
      const rank = { artifact: 3, event: 2, span: 1 };
      return rank[right.kind] - rank[left.kind];
    });
  return candidates[0] || null;
}

export default function useTraceReplay(trace) {
  const [snapshot, setSnapshot] = useState(null);
  const [state, setState] = useState(INITIAL_STATE);
  const previousTick = useRef(0);

  useEffect(() => {
    setSnapshot(null);
    setState(INITIAL_STATE);
  }, [trace?.trace_id]);

  useEffect(() => {
    if (!state.playing || !snapshot) return undefined;
    previousTick.current = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.max(0, now - previousTick.current);
      previousTick.current = now;
      setState((current) => {
        if (!current.playing) return current;
        const cursorMs = Math.min(snapshot.durationMs, current.cursorMs + elapsed * current.speed);
        const completed = cursorMs >= snapshot.durationMs;
        return { ...current, completed, cursorMs, playing: !completed };
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [snapshot, state.playing, state.speed]);

  const start = useCallback(() => {
    const nextSnapshot = createReplaySnapshot(trace);
    if (!nextSnapshot) return;
    setSnapshot(nextSnapshot);
    setState({ ...INITIAL_STATE, active: true, playing: true });
  }, [trace]);
  const pause = useCallback(() => setState((current) => ({ ...current, playing: false })), []);
  const resume = useCallback(() => setState((current) => {
    const atEnd = current.cursorMs >= (snapshot?.durationMs || 0);
    return { ...current, completed: false, cursorMs: atEnd ? 0 : current.cursorMs, playing: true };
  }), [snapshot?.durationMs]);
  const restart = useCallback(() => setState((current) => ({ ...current, completed: false, cursorMs: 0, playing: true })), []);
  const seek = useCallback((cursorMs) => setState((current) => {
    const nextCursor = Math.max(0, Math.min(snapshot?.durationMs || 0, Number(cursorMs) || 0));
    return { ...current, completed: nextCursor >= (snapshot?.durationMs || 0), cursorMs: nextCursor, playing: false };
  }), [snapshot?.durationMs]);
  const setSpeed = useCallback((speed) => setState((current) => ({ ...current, speed: Number(speed) || 1 })), []);
  const stop = useCallback(() => {
    setSnapshot(null);
    setState(INITIAL_STATE);
  }, []);

  const projection = useMemo(
    () => state.active ? buildReplayProjection(snapshot, state.cursorMs) : trace,
    [snapshot, state.active, state.cursorMs, trace],
  );
  const activeItem = useMemo(
    () => (state.active ? activeReplayItem(snapshot, state.cursorMs) : null),
    [snapshot, state.active, state.cursorMs],
  );
  return { ...state, activeItem, durationMs: snapshot?.durationMs || 0, pause, projection, restart, resume, seek, setSpeed, start, stop };
}
