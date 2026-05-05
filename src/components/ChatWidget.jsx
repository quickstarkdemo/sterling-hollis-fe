import { Box, Button, CloseButton, Drawer, HStack, IconButton, Portal, ScrollArea, SimpleGrid, Text, Textarea, VStack } from "@chakra-ui/react";
import { SignInButton } from "@clerk/clerk-react";
import { Link as RouterLink } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiExternalLink, FiLock, FiMessageCircle, FiRefreshCw, FiSend } from "react-icons/fi";

import { useChatContext } from "./ChatContext";
import { sendChat } from "../utils/apiClient";
import { CLERK_ENABLED } from "../utils/clerkConfig";
import { imageFor, money } from "../utils/format";

const genericStarterPrompts = [
  "Find satin evening pieces",
  "What phone number can I call?",
  "What is your return policy?",
];

const categoryStarterPrompts = [
  "Find satin pieces",
  "What phone number can I call?",
  "What is your return policy?",
];

const productStarterPrompts = [
  "Build an outfit around this",
  "Is this available?",
  "What color is this?",
];

function ChatActionButton({ action }) {
  if (action.type === "sign_in" && CLERK_ENABLED) {
    return (
      <SignInButton mode="modal">
        <Button size="sm" className="secondary-button">
          <FiLock />
          {action.label}
        </Button>
      </SignInButton>
    );
  }
  if (action.type === "sign_in") {
    return (
      <Button size="sm" className="secondary-button" disabled>
        <FiLock />
        {action.label}
      </Button>
    );
  }
  if (action.href) {
    if (/^https?:\/\//i.test(action.href)) {
      return (
        <Button as="a" href={action.href} size="sm" className="secondary-button">
          <FiExternalLink />
          {action.label}
        </Button>
      );
    }

    return (
      <Button as={RouterLink} to={action.href} size="sm" className="secondary-button">
        <FiExternalLink />
        {action.label}
      </Button>
    );
  }
  return (
    <Button size="sm" className="secondary-button" disabled>
      {action.label}
    </Button>
  );
}

function ChatProductCard({ product }) {
  return (
    <RouterLink to={`/product/${product.id}`} className="chat-product-card">
      <img src={imageFor(product)} alt={product.title} />
      <Box minW={0}>
        <Text className="eyebrow">{product.brand}</Text>
        <Text className="chat-product-title">{product.title}</Text>
        <Text className="chat-product-price">{money(product.price_min === product.price_max ? product.price : product.price_min)}</Text>
      </Box>
    </RouterLink>
  );
}

function formatChatError(err) {
  const detail = err?.response?.data?.detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== "object") return String(item || "");
        const location = Array.isArray(item.loc) ? item.loc.join(".") : "";
        return [location, item.msg].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    return messages.length ? `Chat request was rejected: ${messages.join("; ")}` : "Chat request was rejected.";
  }
  if (detail && typeof detail === "object") {
    return detail.msg || "Chat request was rejected.";
  }
  return detail || "Chat is unavailable right now.";
}

export default function ChatWidget({ title = "Storefront chat", showDiagnostics = false }) {
  const chatContext = useChatContext();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef(null);

  const starterPrompts = useMemo(() => {
    if (chatContext.current_product) return productStarterPrompts;
    if (chatContext.page_type === "category" || chatContext.category) return categoryStarterPrompts;
    return genericStarterPrompts;
  }, [chatContext.category, chatContext.current_product, chatContext.page_type]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, open]);

  const resetChat = () => {
    if (loading) return;
    setMessages([]);
    setInput("");
    setConversationId(null);
    setError("");
  };

  const submit = async (text = input) => {
    const message = text.trim();
    if (!message || loading) return;
    setError("");
    setInput("");
    setMessages((current) => [...current, { role: "user", content: message, cards: [], actions: [] }]);
    setLoading(true);
    try {
      const response = await sendChat({
        message,
        conversation_id: conversationId || undefined,
        context: chatContext,
      });
      const assistantText =
        response.requires_followup && response.clarifying_question ? response.clarifying_question : response.message;

      if (response.conversation_id) setConversationId(response.conversation_id);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: assistantText,
          cards: response.cards || [],
          actions: response.actions || [],
          toolTrace: response.tool_trace || [],
          identityStatus: response.identity_status,
        },
      ]);
    } catch (err) {
      setError(formatChatError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!open ? (
        <Box className="chat-widget">
          <Button className="chat-launcher" onClick={() => setOpen(true)}>
            <FiMessageCircle />
            Chat
          </Button>
        </Box>
      ) : null}

      <Drawer.Root
        open={open}
        onOpenChange={(details) => setOpen(details.open)}
        placement="end"
        size="full"
        modal={false}
        trapFocus={false}
        preventScroll={false}
        restoreFocus={false}
      >
        <Portal>
          <Drawer.Positioner pointerEvents="none">
            <Drawer.Content className="chat-drawer-content" pointerEvents="auto">
              <Drawer.Header className="chat-drawer-header">
                <Box minW={0}>
                  <Drawer.Title asChild>
                    <Text className="assistant-title">{title}</Text>
                  </Drawer.Title>
                  <Drawer.Description className="muted-mini">Shopping assistant</Drawer.Description>
                </Box>
                <HStack gap={1}>
                  {messages.length || conversationId ? (
                    <IconButton size="sm" variant="ghost" className="icon-button" onClick={resetChat} disabled={loading} aria-label="New chat">
                      <FiRefreshCw />
                    </IconButton>
                  ) : null}
                  <Drawer.CloseTrigger asChild>
                    <CloseButton size="sm" className="icon-button" aria-label="Close chat" />
                  </Drawer.CloseTrigger>
                </HStack>
              </Drawer.Header>

              <Drawer.Body className="chat-drawer-body">
                <ScrollArea.Root className="chat-scroll-area" size="sm" variant="always">
                  <ScrollArea.Viewport ref={threadRef} className="chat-thread">
                    <VStack className="chat-thread-inner" align="stretch" gap={3}>
                      {messages.map((message, index) => (
                        <Box key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
                          <Text>{message.content}</Text>
                          {message.cards?.length ? (
                            <SimpleGrid columns={{ base: 1, lg: 2 }} gap={2} mt={3}>
                              {message.cards.slice(0, 3).map((product) => (
                                <ChatProductCard key={product.id} product={product} />
                              ))}
                            </SimpleGrid>
                          ) : null}
                          {message.actions?.length ? (
                            <HStack mt={3} gap={2} flexWrap="wrap">
                              {message.actions.map((action, actionIndex) => (
                                <ChatActionButton key={`${action.type}-${actionIndex}`} action={action} />
                              ))}
                            </HStack>
                          ) : null}
                          {showDiagnostics && message.toolTrace?.length ? (
                            <VStack align="stretch" gap={1} mt={3} className="chat-tool-trace">
                              {message.toolTrace.map((trace) => (
                                <Text key={`${trace.name}-${trace.decision}`} className="muted-mini">
                                  {trace.name}: {trace.decision}
                                </Text>
                              ))}
                            </VStack>
                          ) : null}
                        </Box>
                      ))}
                      {loading ? <Text className="chat-loading">Working...</Text> : null}
                      {error ? <Text className="error-copy">{error}</Text> : null}
                    </VStack>
                  </ScrollArea.Viewport>
                  <ScrollArea.Scrollbar orientation="vertical">
                    <ScrollArea.Thumb />
                  </ScrollArea.Scrollbar>
                </ScrollArea.Root>
              </Drawer.Body>

              <Drawer.Footer className="chat-drawer-footer">
                <HStack className="chat-starters" gap={2}>
                  {starterPrompts.map((prompt) => (
                    <Button key={prompt} size="xs" className="suggestion-chip" onClick={() => submit(prompt)}>
                      {prompt}
                    </Button>
                  ))}
                </HStack>

                <Box
                  as="form"
                  className="chat-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                  }}
                >
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        submit();
                      }
                    }}
                    placeholder="Ask a shopping question"
                    rows={2}
                  />
                  <IconButton type="submit" className="primary-button" loading={loading} aria-label="Send message">
                    <FiSend />
                  </IconButton>
                </Box>
              </Drawer.Footer>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    </>
  );
}
