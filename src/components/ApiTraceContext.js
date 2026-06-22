import { createContext, useContext } from "react";

import {
  recordApiTraceEvent,
  runWithApiTrace,
  startApiTraceAction,
  subscribeApiTraceEvents,
  traceApiFetch,
} from "../utils/apiTraceClient";

export const INITIAL_API_TRACE_CAPTURE = {
  authorized: false,
  available: false,
  enabled: false,
  surface: "developer",
};

export const ApiTraceContext = createContext({
  ...INITIAL_API_TRACE_CAPTURE,
  setCaptureState: () => {},
  startAction: startApiTraceAction,
  runAction: runWithApiTrace,
  recordEvent: recordApiTraceEvent,
  traceFetch: traceApiFetch,
  subscribe: subscribeApiTraceEvents,
  recentTraces: [],
  recentStatus: "idle",
  selectedTraceId: "",
  selectedTrace: null,
  traceStatus: "idle",
  connectionStatus: "offline",
  traceError: "",
  selectTrace: () => {},
  deleteTraceIds: () => {},
  refreshTraces: async () => {},
});

export function useApiTrace() {
  return useContext(ApiTraceContext);
}
