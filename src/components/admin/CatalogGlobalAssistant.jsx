import { Badge, Box, Button, Drawer, HStack, IconButton, Portal, Text, Textarea, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiSend, FiX } from "react-icons/fi";

import { useApiTrace } from "../ApiTraceContext";
import { normalizeCapabilityDiagnostic } from "../../utils/capabilityDiagnostics";
import {
  createCatalogRealtimeSession,
  createIdempotencyKey,
  queryCatalogAssistant,
  submitCatalogRealtimeV3ToolCall,
} from "../../utils/apiClient";
import RealtimeTranscript from "./RealtimeTranscript";
import VoiceControls from "./VoiceControls";

const MAX_MESSAGES = 12;
const READ_ASSISTANT_TOOLS = new Set([
  "read_catalog_summary",
  "read_inventory_status",
  "read_product_summary",
  "read_publish_readiness",
]);

function citationLabel(citation) {
  const value = citation.value || {};
  if (citation.kind === "inventory") {
    const qty = value.inventory_qty ?? "";
    const store = value.store_name || value.store_id || citation.label;
    return `${store}${qty !== "" ? `: ${qty} unit(s)` : ""}`;
  }
  return citation.label || citation.kind;
}

function voiceOutcome(result) {
  if (!result) return null;
  if (result.status === "succeeded" && result.draft) {
    const version = result.draft.draft_version ? `Draft version ${result.draft.draft_version}` : "Draft updated";
    return {
      label: "Product draft updated",
      detail: `${version}. Review the product inspector before publishing.`,
    };
  }
  if (result.status === "succeeded" && result.suggestion_set) {
    return {
      label: "Review proposal created",
      detail: "Open Suggestions in the product inspector to accept or reject the change.",
    };
  }
  if (result.mutation === false) {
    return {
      label: "Catalog readout",
      detail: "The answer was produced from catalog, store, inventory, or readiness data.",
    };
  }
  if (result.status) {
    return {
      label: result.status === "succeeded" ? "Agent action finished" : "Agent action needs review",
      detail: result.retryable ? "You can try this voice action again." : "No product data changed without review.",
    };
  }
  return null;
}

function diagnosticsForResult(result) {
  if (!result) return [];
  return [
    normalizeCapabilityDiagnostic(result, { operation: "catalog_assistant" }),
    ...(result.tool_trace || []).map((trace) => normalizeCapabilityDiagnostic(trace)),
  ].filter((item) => item.capabilityId || item.surface || item.status);
}

function assistantQuestionFromTool(event) {
  const args = JSON.parse(event.arguments || "{}");
  const fallback = {
    read_catalog_summary: "Summarize catalog inventory risk.",
    read_inventory_status: "Which stores have low stock?",
    read_product_summary: "What should I know about this product?",
    read_publish_readiness: "Summarize publish readiness for this product.",
  };
  return String(args.question || args.query || args.prompt || fallback[event.name] || "Summarize the current catalog context.").trim();
}

function productReadToolName(nextQuestion) {
  const normalized = String(nextQuestion || "").toLowerCase();
  if (/\b(readiness|ready|publish|publication|blocker|blocked)\b/.test(normalized)) {
    return "read_publish_readiness";
  }
  if (/\b(stock|inventory|store|stores|unit|units|availability|available|replenish|low)\b/.test(normalized)) {
    return "read_inventory_status";
  }
  return "read_product_summary";
}

export default function CatalogGlobalAssistant({
  activeDetail,
  currentProductId = "",
  ensureWorkflow,
  onOpenChange,
  onWorkflowEvent,
  open = false,
  productVoiceContext,
  realtimeCapability,
  resetSignal = 0,
  workflowId,
}) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [voiceState, setVoiceState] = useState({
    active: false,
    assistantPartial: "",
    configured: true,
    displayCopy: "",
    entries: [],
    notice: "",
    presenterPartial: "",
    status: "idle",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { startAction } = useApiTrace();
  const threadRef = useRef(null);
  const activeProductId = activeDetail?.product_id || currentProductId || "";
  const previousProductId = useRef(activeProductId);
  const scope = activeProductId ? "product" : "catalog";
  const scopeLabel = scope === "product"
    ? activeDetail?.title || activeProductId || "current product"
    : "entire catalog and inventory";
  const voiceContext = scope === "product" && productVoiceContext
    ? productVoiceContext
    : { mode: "workbench", query_scopes: ["catalog", "inventory"] };

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    const nextProductId = activeProductId;
    if (previousProductId.current === nextProductId) return;
    previousProductId.current = nextProductId;
    setMessages((current) => [
      ...current,
      {
        id: `context-${Date.now()}`,
        role: "system",
        message: nextProductId
          ? `Product context changed. Assistant is scoped to ${activeDetail?.title || nextProductId}.`
          : "Product context cleared. Assistant is scoped to the entire catalog and inventory.",
        citations: [],
      },
    ].slice(-MAX_MESSAGES));
  }, [activeDetail?.title, activeProductId]);

  const starters = useMemo(() => [
    ...(scope === "product" ? ["What should I know about this product?"] : []),
    "Which stores have low stock?",
    "Summarize catalog inventory risk.",
  ], [scope]);

  const assistantPayload = (nextQuestion, requestedScope = scope) => {
    const catalogScope = requestedScope !== "product" || !activeProductId;
    return {
      question: nextQuestion,
      query_scopes: catalogScope ? ["catalog", "inventory"] : ["product"],
      ...(catalogScope ? {} : { product_id: activeProductId }),
    };
  };

  const askProductAssistant = async (nextQuestion) => {
    if (!productVoiceContext) {
      const contextError = new Error("product_context_unavailable");
      contextError.userMessage = "Product context is still loading. Open the Product Panel details, then ask again.";
      throw contextError;
    }
    const activeWorkflowId = workflowId || await ensureWorkflow?.();
    if (!activeWorkflowId) {
      const workflowError = new Error("workflow_unavailable");
      workflowError.userMessage = "The assistant could not start a product read workflow. Try again in a moment.";
      throw workflowError;
    }
    const session = await createCatalogRealtimeSession(activeWorkflowId, productVoiceContext);
    const toolName = productReadToolName(nextQuestion);
    return submitCatalogRealtimeV3ToolCall(activeWorkflowId, {
      session_id: session.session_id,
      call_id: createIdempotencyKey("catalog-assistant-call"),
      name: toolName,
      arguments: { question: nextQuestion },
    }, createIdempotencyKey("catalog-assistant-read"));
  };

  const askAssistant = async (nextQuestion, requestedScope = scope, source = "text") => {
    const payload = assistantPayload(nextQuestion, requestedScope);
    const productScope = requestedScope === "product" && activeProductId;
    const traceAction = startAction("Ask catalog assistant", {
      surface: "catalog-studio",
      attributes: {
        action: source === "voice" ? "assistant_voice_query" : "assistant_text_query",
        product_id: payload.product_id || "",
        query_scopes: payload.query_scopes,
        workflow_id: workflowId || "",
      },
    });
    try {
      const result = productScope
        ? await askProductAssistant(nextQuestion)
        : await queryCatalogAssistant(payload);
      traceAction.end("completed", {
        citation_count: result?.citations?.length || 0,
        product_id: payload.product_id || "",
        workflow_id: workflowId || "",
      });
      return result;
    } catch (requestError) {
      traceAction.end("failed", {
        error_code: requestError?.response?.status || requestError?.code || requestError?.name || "assistant_query_error",
        product_id: payload.product_id || "",
        workflow_id: workflowId || "",
      });
      throw requestError;
    }
  };

  const addMessage = (message) => {
    setMessages((current) => {
      const previous = current[current.length - 1];
      if (previous?.role === message.role && previous?.message === message.message) {
        return current.map((item, index) => index === current.length - 1 ? {
          ...item,
          citations: message.citations?.length ? message.citations : item.citations,
          outcome: message.outcome || item.outcome,
          scope: message.scope || item.scope,
        } : item);
      }
      return [...current, { id: `${Date.now()}-${current.length}`, ...message }].slice(-MAX_MESSAGES);
    });
  };

  const submitQuestion = async (event) => {
    event?.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || busy) return;
    setQuestion("");
    setBusy(true);
    setError("");
    addMessage({ role: "user", message: nextQuestion, citations: [], scope });
    try {
      const result = await askAssistant(nextQuestion);
      addMessage({
        role: "assistant",
        message: result.message || "No answer was returned.",
        citations: result.citations || [],
        diagnostics: diagnosticsForResult(result),
        scope,
      });
    } catch (requestError) {
      setError(
        requestError?.userMessage
          ? requestError.userMessage
          : [502, 503, 504].includes(requestError?.response?.status)
            ? "The assistant backend is temporarily unavailable. Product edits are preserved and text entry remains available."
            : "The assistant could not answer that question. Product edits are preserved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const voiceToolResult = (result) => {
    addMessage({
      role: "assistant",
      message: result?.message || "The voice answer finished.",
      citations: result?.citations || [],
      diagnostics: diagnosticsForResult(result),
      outcome: voiceOutcome(result),
      scope,
    });
  };

  const resolveVoiceToolCall = async ({ event }) => {
    if (!READ_ASSISTANT_TOOLS.has(event.name)) throw new Error("unsupported_read_tool");
    const requestedScope = event.name === "read_product_summary" || event.name === "read_publish_readiness"
      ? "product"
      : scope;
    return askAssistant(assistantQuestionFromTool(event), requestedScope, "voice");
  };

  const voiceTranscript = (entry) => {
    addMessage({
      role: entry.role === "presenter" ? "user" : "assistant",
      message: entry.text,
      citations: [],
      scope,
    });
  };

  const voiceVisible = voiceState.active
    || voiceState.status !== "idle"
    || Boolean(voiceState.entries?.length)
    || Boolean(voiceState.presenterPartial)
    || Boolean(voiceState.assistantPartial)
    || Boolean(voiceState.notice);
  const voiceStatusClass = voiceState.status === "listening" ? "running" : voiceState.status;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(details) => onOpenChange?.(details.open)}
      placement="end"
      size="full"
      modal={false}
      trapFocus={false}
      preventScroll={false}
      restoreFocus={false}
    >
      <Portal>
        <Drawer.Positioner pointerEvents="none">
          <Drawer.Content className="catalog-assistant-drawer-content" pointerEvents="auto">
            <Drawer.Header className="catalog-assistant-drawer-header">
              <Box minW={0}>
                <Drawer.Title asChild>
                  <Text className="assistant-title">Catalog assistant</Text>
                </Drawer.Title>
                <Drawer.Description className="muted-mini">Active scope: {scopeLabel}</Drawer.Description>
              </Box>
              <IconButton type="button" size="sm" variant="ghost" className="icon-button" aria-label="Close catalog assistant" onClick={() => onOpenChange?.(false)}>
                <FiX />
              </IconButton>
            </Drawer.Header>

            <Drawer.Body className="catalog-assistant-drawer-body">
              <VStack align="stretch" gap={4} className="catalog-assistant-drawer-inner">
                <Box>
                  <Text className="section-kicker">Ask AI</Text>
                  <Text className="panel-title">
                    {scope === "product" ? "Ask about this product, stores, and inventory" : "Ask across products, stores, and inventory"}
                  </Text>
                </Box>

                <Box ref={threadRef} className="catalog-assistant-thread" aria-live="polite">
                  <VStack align="stretch" gap={3}>
                    {messages.length ? messages.map((item) => (
                      <Box key={item.id} className={`catalog-assistant-message ${item.role}`}>
                        <HStack gap={2} mb={1}>
                          <Badge className="soft-badge">{item.role === "user" ? "You" : item.role === "system" ? "Context" : "Assistant"}</Badge>
                          {item.scope ? <Text className="muted-text">{item.scope === "product" ? "Current product" : "Catalog"}</Text> : null}
                        </HStack>
                        <Text>{item.message}</Text>
                        {item.citations?.length ? (
                          <HStack className="catalog-assistant-citations" gap={2} flexWrap="wrap" mt={2}>
                            {item.citations.slice(0, 6).map((citation) => (
                              <Badge key={`${citation.kind}-${citation.source_id}-${citation.label}`} className="workflow-status succeeded">
                                {citation.kind}: {citationLabel(citation)}
                              </Badge>
                            ))}
                          </HStack>
                        ) : null}
                        {item.diagnostics?.length ? (
                          <HStack className="catalog-assistant-citations" gap={2} flexWrap="wrap" mt={2}>
                            {item.diagnostics.map((diagnostic, diagnosticIndex) => (
                              <Badge key={`${diagnostic.capabilityId}-${diagnosticIndex}`} className={`workflow-status ${diagnostic.status || "succeeded"}`}>
                                {[diagnostic.label, diagnostic.surface, diagnostic.status].filter(Boolean).join(" - ")}
                              </Badge>
                            ))}
                          </HStack>
                        ) : null}
                        {item.outcome ? (
                          <Box className="catalog-assistant-outcome" mt={3}>
                            <Badge className="workflow-status succeeded">{item.outcome.label}</Badge>
                            <Text className="muted-mini" mt={1}>{item.outcome.detail}</Text>
                          </Box>
                        ) : null}
                      </Box>
                    )) : <Text className="muted-text">Ask about low stock, store coverage, assortment risk, or the selected product.</Text>}
                    {busy ? <Text className="chat-loading">Working...</Text> : null}
                  </VStack>
                </Box>

                {error ? <Text className="catalog-action-hint" role="alert">{error}</Text> : null}

                {voiceVisible ? (
                  <Box className="catalog-assistant-voice-panel">
                    <HStack justify="space-between" gap={3} flexWrap="wrap">
                      <Box>
                        <Text className="filter-label">Realtime voice agent</Text>
                        <Text className="muted-text">{voiceState.displayCopy || "Speak naturally; transcript and outcomes appear in this drawer."}</Text>
                      </Box>
                      <Badge className={`workflow-status ${voiceStatusClass}`}>{voiceState.status}</Badge>
                    </HStack>
                    {voiceState.notice ? <Text className="catalog-action-hint" mt={3}>{voiceState.notice}</Text> : null}
                    <Box mt={3}>
                      <RealtimeTranscript
                        entries={voiceState.entries}
                        presenterPartial={voiceState.presenterPartial}
                        assistantPartial={voiceState.assistantPartial}
                      />
                    </Box>
                  </Box>
                ) : null}

              </VStack>
            </Drawer.Body>

            <Drawer.Footer className="catalog-assistant-drawer-footer">
              <HStack className="chat-starters" gap={2}>
                {starters.map((starter) => (
                  <Button key={starter} type="button" size="xs" className="suggestion-chip" onClick={() => setQuestion(starter)}>
                    {starter}
                  </Button>
                ))}
              </HStack>

              <Box className="chat-form">
                <Textarea
                  aria-label="Catalog assistant question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitQuestion();
                    }
                  }}
                  placeholder="Ask which stores have low stock, or what changed for the selected product..."
                  rows={2}
                  maxLength={1000}
                />
                <VoiceControls
                  workflowId={workflowId}
                  ensureWorkflow={ensureWorkflow}
                  assistantMode="read"
                  realtimeCapability={realtimeCapability}
                  resetSignal={resetSignal}
                  sessionContext={voiceContext}
                  contextLabel={scopeLabel}
                  onToolResult={voiceToolResult}
                  onResolveToolCall={resolveVoiceToolCall}
                  onVoiceStateChange={setVoiceState}
                  onWorkflowEvent={onWorkflowEvent}
                  onTranscriptEntry={voiceTranscript}
                  compact
                />
                <IconButton type="button" className="primary-button" loading={busy} onClick={() => submitQuestion()} aria-label="Ask catalog assistant">
                  <FiSend />
                </IconButton>
              </Box>
              <Text className="muted-mini">Catalog readouts are cited. Product voice outcomes stay reviewable before publish.</Text>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
