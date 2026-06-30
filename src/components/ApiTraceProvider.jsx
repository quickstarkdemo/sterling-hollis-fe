import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useCatalogStudioAccess } from "./CatalogStudioAccessContext";
import { useDeveloperLens } from "./DeveloperLensContext";
import {
  configureApiTraceRuntime,
  recordApiTraceEvent,
  runWithApiTrace,
  startApiTraceAction,
  subscribeApiTraceEvents,
  traceApiFetch,
} from "../utils/apiTraceClient";
import {
  getAdminApiTrace,
  getAdminApiTraceEvents,
  getAdminApiTraces,
  subscribeAdminApiTraceEvents,
} from "../utils/apiClient";
import { mergeTraceEvents } from "../utils/apiTraceProjection";
import {
  ApiTraceContext,
  INITIAL_API_TRACE_CAPTURE,
  useApiTrace,
} from "./ApiTraceContext";

export function ApiTraceCapabilityBridge() {
  const { status, session } = useCatalogStudioAccess();
  const { enabled: developerLensEnabled } = useDeveloperLens();
  const { setCaptureState } = useApiTrace();
  const authorized = status === "authorized";
  const available = authorized && session?.capabilities?.api_traces?.configured === true;

  useEffect(() => {
    setCaptureState({
      authorized,
      available,
      enabled: available && developerLensEnabled,
      surface: "catalog-studio",
    });
  }, [authorized, available, developerLensEnabled, setCaptureState]);

  return null;
}

const HIDDEN_TRACES_KEY = "sterling-hollis:api-trace-hidden:v1";
const STREAM_FALLBACK_FAILURES = 3;
const STREAM_RECONNECT_BASE_MS = 500;
const STREAM_RECONNECT_MAX_MS = 8000;
const STREAM_RECONNECT_JITTER_MS = 250;

function initialHiddenTraces() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(HIDDEN_TRACES_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function persistHiddenTraces(traceIds) {
  try {
    sessionStorage.setItem(HIDDEN_TRACES_KEY, JSON.stringify([...traceIds]));
  } catch {
    // Hidden trace preferences are session-only UI state.
  }
}

function reconnectDelay(attempt) {
  const base = Math.min(
    STREAM_RECONNECT_MAX_MS,
    STREAM_RECONNECT_BASE_MS * (2 ** Math.max(0, Number(attempt) || 0)),
  );
  return base + Math.floor(Math.random() * STREAM_RECONNECT_JITTER_MS);
}

export default function ApiTraceProvider({ children }) {
  const [capture, setCapture] = useState(INITIAL_API_TRACE_CAPTURE);
  const [recentTraces, setRecentTraces] = useState([]);
  const [hiddenTraceIds, setHiddenTraceIds] = useState(initialHiddenTraces);
  const [recentStatus, setRecentStatus] = useState("idle");
  const [selectedTraceId, setSelectedTraceId] = useState("");
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [traceStatus, setTraceStatus] = useState("idle");
  const [connectionStatus, setConnectionStatus] = useState("offline");
  const [traceError, setTraceError] = useState("");

  const setCaptureState = useCallback((nextCapture = {}) => {
    setCapture((current) => ({
      authorized: Boolean(nextCapture.authorized),
      available: Boolean(nextCapture.available),
      enabled: Boolean(nextCapture.enabled),
      surface: nextCapture.surface || current.surface,
    }));
  }, []);

  useEffect(() => {
    configureApiTraceRuntime(capture);
    return () => configureApiTraceRuntime(INITIAL_API_TRACE_CAPTURE);
  }, [capture]);

  const refreshTraces = useCallback(async () => {
    if (!capture.enabled || !capture.authorized) return [];
    setRecentStatus((current) => current === "ready" ? "refreshing" : "loading");
    try {
      const response = await getAdminApiTraces({ limit: 30 });
      const items = (response?.items || []).filter((item) => !hiddenTraceIds.has(item.trace_id));
      setRecentTraces(items);
      setSelectedTraceId((current) => {
        if (current && items.some((item) => item.trace_id === current)) return current;
        return items[0]?.trace_id || current;
      });
      setRecentStatus("ready");
      setTraceError("");
      return items;
    } catch (error) {
      setRecentStatus("error");
      setTraceError(error?.response?.data?.detail || error?.message || "Recent traces could not be loaded.");
      return [];
    }
  }, [capture.authorized, capture.enabled, hiddenTraceIds]);

  const selectTrace = useCallback((traceId) => {
    setSelectedTraceId(String(traceId || ""));
  }, []);

  const deleteTraceIds = useCallback((traceIds = []) => {
    const ids = new Set(traceIds.filter(Boolean));
    if (!ids.size) return;
    setHiddenTraceIds((current) => {
      const next = new Set([...current, ...ids]);
      persistHiddenTraces(next);
      return next;
    });
    setRecentTraces((current) => {
      const remaining = current.filter((trace) => !ids.has(trace.trace_id));
      setSelectedTraceId((currentTraceId) => (ids.has(currentTraceId) ? remaining[0]?.trace_id || "" : currentTraceId));
      return remaining;
    });
    setSelectedTrace((current) => (ids.has(current?.trace_id) ? null : current));
  }, []);

  useEffect(() => {
    if (!capture.enabled || !capture.authorized) {
      setRecentTraces([]);
      setRecentStatus("idle");
      setSelectedTraceId("");
      setSelectedTrace(null);
      setTraceStatus("idle");
      setConnectionStatus("offline");
      setTraceError("");
      return undefined;
    }
    refreshTraces();
    const refreshInterval = window.setInterval(refreshTraces, 8000);
    return () => window.clearInterval(refreshInterval);
  }, [capture.authorized, capture.enabled, refreshTraces]);

  useEffect(() => {
    if (!capture.enabled || !capture.authorized) return undefined;
    let refreshTimer = null;
    const unsubscribe = subscribeApiTraceEvents((event) => {
      if (!event?.trace_id) return;
      if (event.event_type === "ui.started") setSelectedTraceId(event.trace_id);
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(refreshTraces, 250);
    });
    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [capture.authorized, capture.enabled, refreshTraces]);

  useEffect(() => {
    if (!capture.enabled || !capture.authorized || !selectedTraceId) return undefined;
    const controller = new AbortController();
    let active = true;
    let reconnectTimer = null;
    let projectionTimer = null;
    let cursor = -1;

    const loadProjection = async ({ quiet = false } = {}) => {
      if (!quiet) setTraceStatus("loading");
      try {
        const projection = await getAdminApiTrace(selectedTraceId);
        if (!active) return null;
        setSelectedTrace(projection);
        const sequences = (projection.events || [])
          .map((event) => Number(event.sequence))
          .filter(Number.isFinite);
        if (sequences.length) cursor = Math.max(cursor, ...sequences);
        setTraceStatus("ready");
        setTraceError("");
        return projection;
      } catch (error) {
        if (!active || controller.signal.aborted) return null;
        setTraceStatus(error?.response?.status === 404 ? "expired" : "error");
        setTraceError(error?.response?.data?.detail || error?.message || "Trace details could not be loaded.");
        return null;
      }
    };

    const mergeStreamEvents = (items = []) => {
      if (!items.length) return;
      const sequences = items
        .map((event) => Number(event.sequence))
        .filter(Number.isFinite);
      if (sequences.length) cursor = Math.max(cursor, ...sequences);
      setSelectedTrace((current) => current ? {
        ...current,
        events: mergeTraceEvents(current.events, items),
      } : current);
    };

    const catchUpEvents = async () => {
      try {
        const page = await getAdminApiTraceEvents(selectedTraceId, cursor);
        if (!active) return false;
        mergeStreamEvents(page?.items || []);
        if (Number.isFinite(Number(page?.next_cursor))) {
          cursor = Math.max(cursor, Number(page.next_cursor));
        }
        setTraceStatus("ready");
        return "ok";
      } catch (error) {
        if (!active || controller.signal.aborted || error?.name === "AbortError") return "terminal";
        if (error?.response?.status === 401 || error?.response?.status === 403) {
          setConnectionStatus("offline");
          setTraceError("The trace stream is not authorized for this session.");
          return "terminal";
        }
        if (error?.response?.status === 404) {
          setConnectionStatus("expired");
          setTraceStatus("expired");
          return "terminal";
        }
        return "failed";
      }
    };

    const reconnect = (attempt, failureCount = 0, status = "reconnecting") => {
      if (!active || controller.signal.aborted) return;
      setConnectionStatus(status);
      reconnectTimer = window.setTimeout(
        () => connect(attempt + 1, failureCount),
        reconnectDelay(attempt),
      );
    };

    const connect = async (attempt = 0, failureCount = 0) => {
      try {
        const result = await subscribeAdminApiTraceEvents(selectedTraceId, {
          afterSequence: cursor,
          signal: controller.signal,
          onStatus: (status) => {
            if (active) setConnectionStatus(status);
          },
          onEvent: ({ type, data }) => {
            if (!active) return;
            if (type === "expired") {
              setConnectionStatus("expired");
              setTraceStatus("expired");
              return;
            }
            if (type !== "trace_event") return;
            mergeStreamEvents([data]);
            window.clearTimeout(projectionTimer);
            projectionTimer = window.setTimeout(() => loadProjection({ quiet: true }), 120);
          },
        });
        const lastEventSequence = Number(result?.lastEventSequence);
        if (Number.isFinite(lastEventSequence)) cursor = Math.max(cursor, lastEventSequence);
        if (result?.expected || result?.closeReason === "client_abort") return;
        setTraceError("");
        reconnect(attempt, 0);
      } catch (error) {
        if (
          !active
          || controller.signal.aborted
          || error?.name === "AbortError"
          || error?.closeReason === "client_abort"
        ) return;
        if (error?.status === 401 || error?.status === 403) {
          setConnectionStatus("offline");
          setTraceError("The trace stream is not authorized for this session.");
          return;
        }
        if (error?.status === 404) {
          setConnectionStatus("partial");
          await loadProjection({ quiet: true });
          return;
        }
        const nextFailureCount = failureCount + 1;
        setTraceError("Trace stream interrupted. Reconnecting.");
        if (nextFailureCount >= STREAM_FALLBACK_FAILURES) {
          setConnectionStatus("partial");
          if (await catchUpEvents() === "terminal") return;
          reconnect(attempt, nextFailureCount, "partial");
          return;
        }
        reconnect(attempt, nextFailureCount);
      }
    };

    setSelectedTrace(null);
    setTraceError("");
    setConnectionStatus("connecting");
    loadProjection().finally(() => {
      if (active) connect();
    });
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(projectionTimer);
    };
  }, [capture.authorized, capture.enabled, selectedTraceId]);

  const value = useMemo(
    () => ({
      ...capture,
      setCaptureState,
      startAction: startApiTraceAction,
      runAction: runWithApiTrace,
      recordEvent: recordApiTraceEvent,
      traceFetch: traceApiFetch,
      subscribe: subscribeApiTraceEvents,
      recentTraces,
      recentStatus,
      selectedTraceId,
      selectedTrace,
      traceStatus,
      connectionStatus,
      traceError,
      selectTrace,
      deleteTraceIds,
      refreshTraces,
    }),
    [
      capture,
      connectionStatus,
      deleteTraceIds,
      recentStatus,
      recentTraces,
      refreshTraces,
      selectTrace,
      selectedTrace,
      selectedTraceId,
      setCaptureState,
      traceError,
      traceStatus,
    ],
  );

  return <ApiTraceContext.Provider value={value}>{children}</ApiTraceContext.Provider>;
}
