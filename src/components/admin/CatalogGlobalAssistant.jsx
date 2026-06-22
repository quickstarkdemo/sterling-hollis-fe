import { Badge, Box, Button, Drawer, HStack, IconButton, Portal, Text, Textarea, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiSend, FiX } from "react-icons/fi";

import { queryCatalogAssistant } from "../../utils/apiClient";
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

export default function CatalogGlobalAssistant({
  activeDetail,
  ensureWorkflow,
  onOpenChange,
  onWorkflowEvent,
  open = false,
  productVoiceContext,
  realtimeCapability,
  resetSignal = 0,
  workflowId,
}) {
  const [scope, setScope] = useState("catalog");
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
  const threadRef = useRef(null);
  const previousProductId = useRef(activeDetail?.product_id || "");
  const hasProductScope = Boolean(activeDetail?.product_id);
  const scopeLabel = scope === "product" && hasProductScope
    ? activeDetail?.title || activeDetail?.product_id || "current product"
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
    const nextProductId = activeDetail?.product_id || "";
    if (previousProductId.current === nextProductId) return;
    previousProductId.current = nextProductId;
    if (scope === "product") setScope("catalog");
    setMessages((current) => [
      ...current,
      {
        id: `context-${Date.now()}`,
        role: "system",
        message: "Product context changed. Scope reset to entire catalog and inventory.",
        citations: [],
      },
    ].slice(-MAX_MESSAGES));
  }, [activeDetail?.product_id, scope]);

  const starters = useMemo(() => [
    "Which stores have low stock?",
    "Summarize catalog inventory risk.",
    ...(hasProductScope ? ["What should I know about this product?"] : []),
  ], [hasProductScope]);

  const assistantPayload = (nextQuestion, requestedScope = scope) => {
    const productScope = requestedScope === "product" && activeDetail?.product_id;
    const currentDraft = activeDetail?.current_draft;
    return {
      question: nextQuestion,
      query_scopes: productScope ? ["product", "inventory", "readiness"] : ["catalog", "inventory"],
      ...(productScope ? {
        product_id: activeDetail.product_id,
        draft_id: currentDraft?.revision?.id,
        expected_draft_version: currentDraft?.draft_version,
      } : {}),
    };
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
      const result = await queryCatalogAssistant(assistantPayload(nextQuestion));
      addMessage({
        role: "assistant",
        message: result.message || "No answer was returned.",
        citations: result.citations || [],
        scope,
      });
    } catch (requestError) {
      setError(
        [502, 503, 504].includes(requestError?.response?.status)
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
      outcome: voiceOutcome(result),
      scope,
    });
  };

  const resolveVoiceToolCall = async ({ event }) => {
    if (!READ_ASSISTANT_TOOLS.has(event.name)) throw new Error("unsupported_read_tool");
    const requestedScope = event.name === "read_product_summary" || event.name === "read_publish_readiness"
      ? "product"
      : scope;
    return queryCatalogAssistant(assistantPayload(assistantQuestionFromTool(event), requestedScope));
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
                  <Text className="panel-title">Ask across products, stores, and inventory</Text>
                </Box>

                <HStack className="catalog-assistant-scope" role="radiogroup" aria-label="Assistant scope" gap={2} flexWrap="wrap">
                  <Button type="button" size="sm" className={scope === "catalog" ? "product-workbench-tab active" : "product-workbench-tab"} aria-pressed={scope === "catalog"} onClick={() => setScope("catalog")}>
                    Entire catalog & inventory
                  </Button>
                  <Button type="button" size="sm" className={scope === "product" ? "product-workbench-tab active" : "product-workbench-tab"} aria-pressed={scope === "product"} disabled={!hasProductScope} onClick={() => setScope("product")}>
                    Current product
                  </Button>
                </HStack>

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
