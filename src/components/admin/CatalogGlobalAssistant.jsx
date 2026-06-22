import { Badge, Box, Button, Drawer, HStack, IconButton, Portal, Text, Textarea, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiSend, FiX } from "react-icons/fi";

import { queryCatalogAssistant } from "../../utils/apiClient";
import VoiceControls from "./VoiceControls";

const MAX_MESSAGES = 12;

function productSnapshot(detail) {
  return detail?.current_draft?.product || detail?.published_snapshot || null;
}

function productInventoryRows(product) {
  return (product?.variants || []).flatMap((variant) =>
    (variant.inventory || []).map((row) => ({
      ...row,
      variant_id: variant.variant_id,
      color: variant.color,
      size: row.size || variant.size || "",
    })),
  );
}

function productAnswer(detail, question) {
  const product = productSnapshot(detail);
  if (!product) {
    return {
      message: "Select a product with a loaded draft before asking for current-product drill-down.",
      citations: [],
    };
  }
  const inventory = productInventoryRows(product);
  const lowStock = inventory.filter((row) =>
    String(row.availability || "").toLowerCase() === "low stock" || Number(row.inventory_qty || 0) <= 5,
  );
  const inventoryFocus = /stock|inventory|store|unit|available|availability/i.test(question);
  const citations = [
    {
      kind: "product",
      source_id: product.product_id || detail.product_id,
      label: product.title || detail.title || "Current product",
      value: {
        product_id: product.product_id || detail.product_id,
        title: product.title || detail.title,
        brand: product.brand,
        category: product.category,
      },
    },
    ...inventory.slice(0, 5).map((row) => ({
      kind: "inventory",
      source_id: `${product.product_id || detail.product_id}:${row.store_id}:${row.variant_id || row.size || "inventory"}`,
      label: `${row.store_id || "Store"}${row.size ? ` ${row.size}` : ""}`,
      value: {
        store_id: row.store_id,
        size: row.size,
        color: row.color,
        availability: row.availability,
        inventory_qty: row.inventory_qty,
      },
    })),
  ];
  if (inventoryFocus) {
    const rows = lowStock.length ? lowStock : inventory;
    const preview = rows.slice(0, 3).map((row) =>
      `${row.store_id || "store"} has ${Number(row.inventory_qty || 0)} unit(s)${row.size ? ` in ${row.size}` : ""}`,
    ).join("; ");
    return {
      message: preview
        ? `${product.title || detail.title} inventory: ${preview}.`
        : `${product.title || detail.title} has no inventory rows in the loaded draft.`,
      citations,
    };
  }
  return {
    message: `${product.title || detail.title} is ${product.brand || "an unbranded item"} in ${product.category || "the catalog"}. ${product.description || "No description is available in the loaded draft."}`,
    citations,
  };
}

function citationLabel(citation) {
  const value = citation.value || {};
  if (citation.kind === "inventory") {
    const qty = value.inventory_qty ?? "";
    const store = value.store_name || value.store_id || citation.label;
    return `${store}${qty !== "" ? `: ${qty} unit(s)` : ""}`;
  }
  return citation.label || citation.kind;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef(null);
  const previousProductId = useRef(activeDetail?.product_id || "");
  const hasProductScope = Boolean(productSnapshot(activeDetail));
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

  const addMessage = (message) => {
    setMessages((current) => {
      const previous = current[current.length - 1];
      if (previous?.role === message.role && previous?.message === message.message) return current;
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
      const result = scope === "product"
        ? productAnswer(activeDetail, nextQuestion)
        : await queryCatalogAssistant({
          question: nextQuestion,
          query_scopes: ["catalog", "inventory"],
        });
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
      scope,
    });
  };

  const voiceTranscript = (entry) => {
    addMessage({
      role: entry.role === "presenter" ? "user" : "assistant",
      message: entry.text,
      citations: [],
      scope,
    });
  };

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
                      </Box>
                    )) : <Text className="muted-text">Ask about low stock, store coverage, assortment risk, or the selected product.</Text>}
                    {busy ? <Text className="chat-loading">Working...</Text> : null}
                  </VStack>
                </Box>

                {error ? <Text className="catalog-action-hint" role="alert">{error}</Text> : null}

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
                  onWorkflowEvent={onWorkflowEvent}
                  onTranscriptEntry={voiceTranscript}
                  compact
                />
                <IconButton type="button" className="primary-button" loading={busy} onClick={() => submitQuestion()} aria-label="Ask catalog assistant">
                  <FiSend />
                </IconButton>
              </Box>
              <Text className="muted-mini">Answers are read-only and cited.</Text>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
