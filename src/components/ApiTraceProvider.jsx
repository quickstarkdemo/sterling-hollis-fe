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

export default function ApiTraceProvider({ children }) {
  const [capture, setCapture] = useState(INITIAL_API_TRACE_CAPTURE);
  const [recentTraces, setRecentTraces] = useState([]);
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
      const items = response?.items || [];
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
  }, [capture.authorized, capture.enabled]);

  const selectTrace = useCallback((traceId) => {
    setSelectedTraceId(String(traceId || ""));
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
        cursor = Math.max(cursor, ...(projection.events || []).map((event) => Number(event.sequence)));
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

    const reconnect = (attempt) => {
      if (!active || controller.signal.aborted) return;
      setConnectionStatus("reconnecting");
      reconnectTimer = window.setTimeout(() => connect(attempt + 1), Math.min(8000, 500 * (2 ** attempt)));
    };

    const connect = async (attempt = 0) => {
      try {
        await subscribeAdminApiTraceEvents(selectedTraceId, {
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
            cursor = Math.max(cursor, Number(data.sequence));
            setSelectedTrace((current) => current ? {
              ...current,
              events: mergeTraceEvents(current.events, [data]),
            } : current);
            window.clearTimeout(projectionTimer);
            projectionTimer = window.setTimeout(() => loadProjection({ quiet: true }), 120);
          },
        });
        reconnect(attempt);
      } catch (error) {
        if (!active || controller.signal.aborted || error?.name === "AbortError") return;
        if (error?.status === 401 || error?.status === 403) {
          setConnectionStatus("offline");
          setTraceError("The trace stream is not authorized for this session.");
          return;
        }
        if (error?.status === 404) {
          setConnectionStatus("partial");
          await loadProjection({ quiet: true });
        }
        reconnect(attempt);
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
      refreshTraces,
    }),
    [
      capture,
      connectionStatus,
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
