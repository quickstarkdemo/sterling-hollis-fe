import { Box, Button, HStack, Input, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { SignInButton } from "@clerk/clerk-react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiChevronDown, FiExternalLink, FiLock, FiMessageCircle, FiSend } from "react-icons/fi";

import { getProducts, searchProducts, sendChat } from "../utils/apiClient";
import { CLERK_ENABLED } from "../utils/clerkConfig";
import { imageFor, money, titleize } from "../utils/format";

const starterPrompts = [
  "What goes with this?",
  "Is this available?",
  "What would you recommend for me?",
];

const currentItemTerms = /\b(this|that|it|item|product|piece|available|availability|stock|inventory|size|sizes|color|material|price|cost|pair|pairs|match|matches|similar)\b/i;
const searchIntentTerms = /\b(find|show|search|looking for|look for|do you have|have any|need|recommend|suggest)\b/i;
const pairingTerms = /\b(go(?:es)? with|pair(?:s|ing)?|match(?:es|ing)?|complement(?:s|ary)?)\b/i;
const budgetMaxPattern = /\b(?:under|below|less than|max(?:imum)?|up to)\s*\$?\s*(\d+(?:\.\d{1,2})?)\b/i;

const searchableProductTerms = [
  { pattern: /\b(blouses?|tops?|shirts?|dresses?|skirts?|pants|trousers?|coats?|jackets?|blazers?|sweaters?|cardigans?|jeans)\b/i, category: "womens_apparel" },
  { pattern: /\b(moisturizers?|serums?|palettes?|lip colors?|lipstick|fragrances?|perfumes?|skincare|makeup)\b/i, category: "beauty" },
  { pattern: /\b(purses?|handbags?|bags?|totes?|clutches?)\b/i, category: "handbags" },
  { pattern: /\b(shoes?|heels?|pumps?|boots?|sandals?|sneakers?)\b/i, category: "shoes" },
  { pattern: /\b(earrings?|necklaces?|bracelets?|rings?|jewelry|accessories)\b/i, category: "jewelry_accessories" },
  { pattern: /\b(dinnerware|chair|chairs|vases?|home|decor)\b/i, category: "home" },
];

const complementaryCategories = {
  handbags: "womens_apparel",
  shoes: "womens_apparel",
  jewelry_accessories: "womens_apparel",
  womens_apparel: "shoes",
  mens_apparel: "shoes",
  beauty: "jewelry_accessories",
};

function withoutCurrentProductContext(context) {
  const shoppingContext = { ...context };
  delete shoppingContext.product_id;
  return shoppingContext;
}

function shouldUseCurrentProductContext(message) {
  return currentItemTerms.test(message);
}

function singularizeTerm(term) {
  return term.toLowerCase().replace(/\s+/g, " ").replace(/s\b/, "");
}

function findSearchTerm(message) {
  for (const term of searchableProductTerms) {
    const match = message.match(term.pattern);
    if (match) {
      return {
        category: term.category,
        query: singularizeTerm(match[0]),
      };
    }
  }
  return null;
}

function buildLocalSearchPlan(message, context) {
  const trimmed = message.trim();
  const hasPairingIntent = pairingTerms.test(trimmed);
  const hasSearchIntent = searchIntentTerms.test(trimmed);
  const explicitTerm = findSearchTerm(trimmed);

  if (!explicitTerm && !hasPairingIntent) return null;
  if (!explicitTerm && !hasSearchIntent && !hasPairingIntent) return null;

  const color = context.attributes?.color;
  const queryParts = [];
  if (hasPairingIntent && color) queryParts.push(color);
  if (explicitTerm?.query) queryParts.push(explicitTerm.query);
  if (!explicitTerm?.query && color) queryParts.push(color);

  const maxPriceMatch = trimmed.match(budgetMaxPattern);
  const category = explicitTerm?.category || complementaryCategories[context.category];

  return {
    query: queryParts.join(" ").trim(),
    params: {
      category,
      max_price: maxPriceMatch ? maxPriceMatch[1] : undefined,
      limit: 3,
    },
    label: explicitTerm?.query || "matching pieces",
    pairing: hasPairingIntent,
    fallbackToCategory: !explicitTerm,
  };
}

function localSearchMessage(plan, products) {
  if (!products.length) {
    return `I couldn't find ${plan.label} in the catalog for that request.`;
  }
  if (plan.pairing) {
    return `I found ${plan.label} options that should work with this item.`;
  }
  return `I found ${plan.label} options in the catalog.`;
}

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
      const localSearchPlan = buildLocalSearchPlan(message, chatContext);
      if (localSearchPlan) {
        const result = await searchProducts(localSearchPlan.query, localSearchPlan.params);
        let cards = result.items || [];
        if (!cards.length && localSearchPlan.fallbackToCategory && localSearchPlan.params.category) {
          const fallbackResult = await getProducts(localSearchPlan.params);
          cards = fallbackResult.items || [];
        }
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: localSearchMessage(localSearchPlan, cards),
            cards,
            actions: cards.map((product) => ({
              type: "view_product",
              label: `View ${titleize(product.title)}`,
              href: `/product/${product.id}`,
            })),
          },
        ]);
        return;
      }
      const requestContext = shouldUseCurrentProductContext(message)
        ? chatContext
        : withoutCurrentProductContext(chatContext);
      const response = await sendChat({
        message,
        conversation_id: conversationId || undefined,
        context: requestContext,
      });
      setConversationId(response.conversation_id);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.message,
          cards: response.cards || [],
          actions: response.actions || [],
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
