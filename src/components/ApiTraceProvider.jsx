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

  const value = useMemo(
    () => ({
      ...capture,
      setCaptureState,
      startAction: startApiTraceAction,
      runAction: runWithApiTrace,
      recordEvent: recordApiTraceEvent,
      traceFetch: traceApiFetch,
      subscribe: subscribeApiTraceEvents,
    }),
    [capture, setCaptureState],
  );

  return <ApiTraceContext.Provider value={value}>{children}</ApiTraceContext.Provider>;
}
