import { Box, Button, HStack, Input, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { SignInButton } from "@clerk/clerk-react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiChevronDown, FiExternalLink, FiLock, FiMessageCircle, FiSend } from "react-icons/fi";

import { sendChat } from "../utils/apiClient";
import { CLERK_ENABLED } from "../utils/clerkConfig";
import { imageFor, money } from "../utils/format";

const starterPrompts = [
  "What goes with this?",
  "Is this available?",
  "What would you recommend for me?",
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

export default function ChatWidget({ context = {}, title = "Atelier chat" }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef(null);

  const chatContext = useMemo(
    () => ({
      route: location.pathname,
      ...context,
    }),
    [context, location.pathname],
  );

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, open]);

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
      setConversationId(response.conversation_id);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.message,
          cards: response.cards || [],
          actions: response.actions || [],
          toolTrace: response.tool_trace || [],
          identityStatus: response.identity_status,
        },
      ]);
    } catch (err) {
      setError(err?.response?.data?.detail || "Chat is unavailable right now.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box className={`chat-widget ${open ? "open" : ""}`}>
      {open ? (
        <Box className="chat-panel">
          <HStack className="chat-header" justify="space-between">
            <Box>
              <Text className="assistant-title">{title}</Text>
            </Box>
            <Button size="sm" variant="ghost" className="icon-button" onClick={() => setOpen(false)}>
              <FiChevronDown />
            </Button>
          </HStack>

          <VStack ref={threadRef} className="chat-thread" align="stretch" gap={3}>
            {messages.map((message, index) => (
              <Box key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
                <Text>{message.content}</Text>
                {message.cards?.length ? (
                  <SimpleGrid columns={{ base: 1, md: 2 }} gap={2} mt={3}>
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
                {message.toolTrace?.length ? (
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
            <Input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a shopping question" />
            <Button type="submit" className="primary-button" loading={loading}>
              <FiSend />
            </Button>
          </Box>
        </Box>
      ) : (
        <Button className="chat-launcher" onClick={() => setOpen(true)}>
          <FiMessageCircle />
          Chat
        </Button>
      )}
    </Box>
  );
}
