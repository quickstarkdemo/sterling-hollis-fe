import { useCallback, useEffect, useRef } from "react";

import {
  createCatalogRealtimeSession,
  submitCatalogRealtimeToolCall,
  submitCatalogRealtimeV3ToolCall,
} from "../utils/apiClient";

const LEGACY_TOOLS = new Set(["create_catalog_draft", "refine_catalog_draft"]);
const WORKBENCH_TOOLS = new Set([
  "read_product_summary",
  "read_catalog_summary",
  "read_inventory_status",
  "read_publish_readiness",
  "propose_product_field",
]);

export default function useCatalogRealtimeSession(sessionContext) {
  const sessionIdRef = useRef("");
  const contextRef = useRef(sessionContext);
  const activeContextRef = useRef(null);
  contextRef.current = sessionContext;

  const resetBackendSession = useCallback(() => {
    sessionIdRef.current = "";
    activeContextRef.current = null;
  }, []);

  useEffect(() => resetBackendSession, [resetBackendSession]);

  const startBackendSession = useCallback(async (workflowId) => {
    resetBackendSession();
    const context = contextRef.current;
    const session = await createCatalogRealtimeSession(workflowId, context);
    activeContextRef.current = context;
    sessionIdRef.current = session.session_id || "";
    return session;
  }, [resetBackendSession]);

  const submitToolCall = useCallback(async (workflowId, event, idempotencyKey) => {
    const contextual = Boolean(activeContextRef.current);
    const allowedTools = contextual ? WORKBENCH_TOOLS : LEGACY_TOOLS;
    if (!allowedTools.has(event.name)) throw new Error("unsupported_tool");
    const argumentsPayload = JSON.parse(event.arguments || "{}");
    const submit = contextual ? submitCatalogRealtimeV3ToolCall : submitCatalogRealtimeToolCall;
    return submit(workflowId, {
      ...(contextual ? { session_id: sessionIdRef.current } : {}),
      call_id: String(event.call_id || ""),
      name: event.name,
      arguments: argumentsPayload,
    }, idempotencyKey);
  }, []);

  return { resetBackendSession, startBackendSession, submitToolCall };
}
