import { Box, Button, CloseButton, Drawer, HStack, IconButton, Portal, ScrollArea, SimpleGrid, Text, Textarea, VStack } from "@chakra-ui/react";
import { SignInButton } from "@clerk/clerk-react";
import { Link as RouterLink } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiExternalLink, FiLock, FiMessageCircle, FiMic, FiMicOff, FiRefreshCw, FiSend } from "react-icons/fi";

import { useChatContext } from "./ChatContext";
import { useApiTrace } from "./ApiTraceContext";
import {
  createShopperRealtimeSession,
  getShopperRealtimeCapability,
  sendChat,
  submitShopperRealtimeToolCall,
} from "../utils/apiClient";
import { recordApiTraceEvent } from "../utils/apiTraceClient";
import { recordVisibleConversationTurn } from "../utils/apiTraceConversation";
import { CLERK_ENABLED } from "../utils/clerkConfig";
import { capabilityDiagnosticParts } from "../utils/capabilityDiagnostics";
import { imageFor, money } from "../utils/format";
import {
  defaultMicrophoneRequest,
  defaultPeerConnection,
  defaultSdpExchange,
  realtimeErrorCode,
  realtimeFailureStatus,
} from "../utils/realtimeVoice";

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

const voiceActiveStates = new Set(["requesting", "connecting", "listening", "speaking"]);
const voiceUnavailableCopy = {
  feature_disabled: "Voice is disabled here. Text chat is ready.",
  openai_unconfigured: "Voice is not configured yet. Text chat is ready.",
  safety_identifier_unconfigured: "Voice needs a backend safety setting. Text chat is ready.",
};

function voiceStatusText(status) {
  if (status === "requesting") return "Requesting microphone";
  if (status === "connecting") return "Connecting voice";
  if (status === "listening") return "Listening";
  if (status === "speaking") return "Speaking";
  return "Voice";
}

function parseRealtimeArguments(event) {
  const raw = event?.arguments || "{}";
  if (typeof raw === "string") return JSON.parse(raw || "{}");
  return raw && typeof raw === "object" ? raw : {};
}

function shopperToolOutput(result) {
  return JSON.stringify(result?.tool_output || {
    status: result?.status || "failed",
    message: result?.message || "The shopper voice turn finished.",
    retryable: Boolean(result?.retryable),
  });
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

export default function ChatWidget({
  title = "Storefront chat",
  showDiagnostics = false,
  voiceEnabled = true,
  createVoicePeerConnection = defaultPeerConnection,
  requestVoiceMicrophone = defaultMicrophoneRequest,
  exchangeVoiceSdp = defaultSdpExchange,
  now = () => Date.now(),
}) {
  const chatContext = useChatContext();
  const { startAction } = useApiTrace();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [voiceCapability, setVoiceCapability] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceNotice, setVoiceNotice] = useState("");
  const threadRef = useRef(null);
  const conversationIdRef = useRef(conversationId);
  const chatContextRef = useRef(chatContext);
  const voiceGenerationRef = useRef(0);
  const voicePeerRef = useRef(null);
  const voiceChannelRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const voiceAudioRef = useRef(null);
  const voiceAbortRef = useRef(null);
  const voiceExpiryRef = useRef(null);
  const voiceSessionIdRef = useRef("");
  const handledVoiceCallsRef = useRef(new Set());
  const voiceTraceActionRef = useRef(null);
  const voiceTranscriptRef = useRef("");
  const voiceAssistantPartialRef = useRef("");
  const voiceTurnSequenceRef = useRef(0);
  conversationIdRef.current = conversationId;
  chatContextRef.current = chatContext;

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

  useEffect(() => {
    if (!open || !voiceEnabled || voiceCapability) return undefined;
    let cancelled = false;
    getShopperRealtimeCapability()
      .then((capability) => {
        if (!cancelled) setVoiceCapability(capability);
      })
      .catch(() => {
        if (!cancelled) setVoiceCapability(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, voiceCapability, voiceEnabled]);

  const clearVoiceResources = useCallback(() => {
    if (voiceExpiryRef.current) clearTimeout(voiceExpiryRef.current);
    voiceExpiryRef.current = null;
    voiceAbortRef.current?.abort();
    voiceAbortRef.current = null;
    voiceChannelRef.current?.close?.();
    voicePeerRef.current?.close?.();
    voiceStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    if (voiceAudioRef.current) {
      const isJsdomMediaShim = /jsdom/i.test(window.navigator?.userAgent ?? "");
      try {
        if (!isJsdomMediaShim) voiceAudioRef.current.pause?.();
      } catch {
        // Media shims can expose pause() without implementing it.
      }
      try {
        voiceAudioRef.current.srcObject = null;
      } catch {
        // Some test/browser shims do not expose srcObject as a writable field.
      }
      voiceAudioRef.current.remove?.();
    }
    voiceChannelRef.current = null;
    voicePeerRef.current = null;
    voiceStreamRef.current = null;
    voiceAudioRef.current = null;
  }, []);

  const endVoiceSession = useCallback((nextStatus = "idle", nextNotice = "") => {
    const traceAction = voiceTraceActionRef.current;
    if (traceAction?.enabled) {
      if (["idle", "disconnected", "expired"].includes(nextStatus)) {
        recordApiTraceEvent(
          "realtime.disconnected",
          { connection_state: nextStatus, transport: "webrtc" },
          { action: traceAction, status: nextStatus },
        );
      }
      traceAction.end(nextStatus === "idle" || nextStatus === "disconnected" ? "completed" : "failed", {
        connection_state: nextStatus,
        transport: "webrtc",
      });
    }
    voiceTraceActionRef.current = null;
    voiceGenerationRef.current += 1;
    voiceSessionIdRef.current = "";
    handledVoiceCallsRef.current = new Set();
    voiceTranscriptRef.current = "";
    voiceAssistantPartialRef.current = "";
    clearVoiceResources();
    setVoiceStatus(nextStatus);
    setVoiceNotice(nextNotice);
  }, [clearVoiceResources]);

  useEffect(() => () => {
    voiceTraceActionRef.current?.end("cancelled", {
      cancelled: true,
      connection_state: "unmounted",
      transport: "webrtc",
    });
    voiceTraceActionRef.current = null;
    voiceGenerationRef.current += 1;
    clearVoiceResources();
  }, [clearVoiceResources]);

  useEffect(() => {
    if (!open && voiceActiveStates.has(voiceStatus)) endVoiceSession("idle");
  }, [endVoiceSession, open, voiceStatus]);

  const appendAssistantResponse = (response) => {
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
    return assistantText;
  };

  const resetChat = () => {
    if (loading) return;
    endVoiceSession("idle");
    setMessages([]);
    setInput("");
    setConversationId(null);
    setError("");
    setVoiceNotice("");
  };

  const submit = async (text = input) => {
    const message = text.trim();
    if (!message || loading) return;
    setError("");
    setInput("");
    setMessages((current) => [...current, { role: "user", content: message, cards: [], actions: [] }]);
    setLoading(true);
    const traceAction = startAction("Storefront chat turn", {
      surface: "storefront-chat",
      attributes: {
        action: "chat_turn",
        conversation_id: conversationId || "",
        product_id: chatContext.current_product?.id || chatContext.current_product?.product_id || "",
      },
    });
    try {
      const response = await sendChat({
        message,
        conversation_id: conversationId || undefined,
        context: chatContext,
      });
      appendAssistantResponse(response);
      traceAction.end("completed", {
        conversation_id: response.conversation_id || conversationId || "",
      });
    } catch (err) {
      setError(formatChatError(err));
      traceAction.end("failed", {
        error_code: err?.response?.status || err?.code || err?.name || "chat_error",
      });
    } finally {
      setLoading(false);
    }
  };

  const sendVoiceEvent = (event) => {
    if (voiceChannelRef.current?.readyState === "open") voiceChannelRef.current.send(JSON.stringify(event));
  };

  const executeVoiceToolCall = async (event, generation) => {
    const callId = String(event.call_id || "");
    if (!callId || handledVoiceCallsRef.current.has(callId)) return;
    handledVoiceCallsRef.current.add(callId);

    let message = "";
    try {
      const argumentsPayload = parseRealtimeArguments(event);
      message = String(argumentsPayload.message || "").trim();
      if (!message || event.name !== "shopper_chat_turn") throw new Error("unsupported_tool");
    } catch {
      sendVoiceEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ status: "failed", message: "The shopper voice request was not readable.", retryable: true }),
        },
      });
      sendVoiceEvent({ type: "response.create" });
      return;
    }

    setError("");
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: message, cards: [], actions: [], source: "voice" }]);
    const productId = chatContextRef.current.current_product?.id || chatContextRef.current.product_id || "";
    const traceAction = startAction("Storefront voice chat turn", {
      surface: "storefront-chat",
      attributes: {
        action: "voice_chat_turn",
        conversation_id: conversationIdRef.current || "",
        product_id: productId,
      },
    });
    voiceTurnSequenceRef.current += 1;
    const turnId = `shopper-voice-${voiceTurnSequenceRef.current}`;
    recordVisibleConversationTurn({
      action: traceAction,
      conversationId: conversationIdRef.current || "",
      createdAt: new Date().toISOString(),
      messageId: `${turnId}:user`,
      role: "user",
      route: "shopper_realtime_voice",
      selectedTool: event.name,
      source: "realtime_transcript",
      text: message,
      turnId,
    });

    try {
      const result = await submitShopperRealtimeToolCall({
        session_id: voiceSessionIdRef.current,
        call_id: callId,
        name: event.name,
        arguments: { message },
        conversation_id: conversationIdRef.current || undefined,
        context: chatContextRef.current,
      });
      if (voiceGenerationRef.current !== generation) return;
      const response = result.chat_response || result;
      const assistantText = appendAssistantResponse(response);
      recordVisibleConversationTurn({
        action: traceAction,
        actionCount: response.actions?.length || 0,
        cardCount: response.cards?.length || 0,
        conversationId: response.conversation_id || conversationIdRef.current || "",
        createdAt: new Date().toISOString(),
        messageId: `${turnId}:assistant`,
        role: "assistant",
        route: "shopper_realtime_voice",
        selectedTool: event.name,
        source: "chat_response",
        text: assistantText,
        toolCount: response.tool_trace?.length || 0,
        turnId,
      });
      traceAction.end("completed", {
        conversation_id: response.conversation_id || conversationIdRef.current || "",
      });
      sendVoiceEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: shopperToolOutput(result) },
      });
      sendVoiceEvent({ type: "response.create" });
    } catch (err) {
      if (voiceGenerationRef.current !== generation) return;
      setError(formatChatError(err));
      traceAction.end("failed", {
        error_code: err?.response?.status || err?.code || err?.name || "voice_chat_error",
      });
      sendVoiceEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ status: "failed", message: "The shopper voice turn could not run.", retryable: true }),
        },
      });
      sendVoiceEvent({ type: "response.create" });
    } finally {
      setLoading(false);
      if (voiceGenerationRef.current === generation) {
        setVoiceStatus("listening");
      }
    }
  };

  const handleVoiceRealtimeEvent = (event, generation) => {
    if (voiceGenerationRef.current !== generation) return;
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        voiceTranscriptRef.current = `${voiceTranscriptRef.current}${event.delta || ""}`.slice(-2000);
        setVoiceStatus("listening");
        break;
      case "conversation.item.input_audio_transcription.completed":
        voiceTranscriptRef.current = String(event.transcript || voiceTranscriptRef.current || "").slice(-2000);
        setVoiceStatus("listening");
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        voiceAssistantPartialRef.current = `${voiceAssistantPartialRef.current}${event.delta || ""}`.slice(-2000);
        setVoiceStatus("speaking");
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        voiceAssistantPartialRef.current = "";
        setVoiceStatus("listening");
        break;
      case "response.function_call_arguments.done":
        void executeVoiceToolCall(event, generation);
        break;
      case "error":
        {
          const errorCode = String(event.error?.code || event.error?.type || event.code || "provider_event");
          recordApiTraceEvent(
            "realtime.error",
            { error_code: errorCode, transport: "webrtc" },
            { action: voiceTraceActionRef.current, status: "warning" },
          );
          if (/expired|invalid_session|session_not_found/i.test(errorCode)) {
            endVoiceSession("expired", "Voice expired. Text chat is still available.");
            break;
          }
          setVoiceNotice("Voice reported a provider issue. Text chat is still available.");
        }
        break;
      default:
        break;
    }
  };

  const startVoice = async () => {
    if (!voiceEnabled || loading || voiceActiveStates.has(voiceStatus)) return;
    if (voiceCapability?.configured === false) {
      setVoiceNotice(voiceUnavailableCopy[voiceCapability.reason] || "Voice is unavailable. Text chat is ready.");
      return;
    }
    if (!voiceCapability?.configured) return;

    voiceTraceActionRef.current?.end("cancelled", { cancelled: true });
    voiceTraceActionRef.current = startAction("Start storefront voice session", {
      surface: "storefront-chat",
      attributes: {
        action: "voice_session",
        conversation_id: conversationIdRef.current || "",
        product_id: chatContextRef.current.current_product?.id || chatContextRef.current.product_id || "",
      },
    });
    const generation = voiceGenerationRef.current + 1;
    voiceGenerationRef.current = generation;
    clearVoiceResources();
    handledVoiceCallsRef.current = new Set();
    voiceTranscriptRef.current = "";
    voiceAssistantPartialRef.current = "";
    setVoiceNotice("");
    setError("");
    setVoiceStatus("requesting");

    try {
      const stream = await requestVoiceMicrophone();
      if (voiceGenerationRef.current !== generation) {
        stream.getTracks?.().forEach((track) => track.stop());
        return;
      }
      voiceStreamRef.current = stream;
      setVoiceStatus("connecting");
      const session = await createShopperRealtimeSession({ context: chatContextRef.current });
      if (voiceGenerationRef.current !== generation) return;
      voiceSessionIdRef.current = session.session_id || "";

      const expiresAt = Number(session.expires_at) * 1000;
      if (expiresAt - now() <= 0) {
        endVoiceSession("expired", "Voice expired before it connected. Text chat is still available.");
        return;
      }

      const peer = createVoicePeerConnection();
      voicePeerRef.current = peer;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute("data-realtime-audio", "true");
      audio.style.display = "none";
      document.body?.appendChild(audio);
      voiceAudioRef.current = audio;
      peer.ontrack = (trackEvent) => {
        if (voiceGenerationRef.current !== generation) return;
        try {
          audio.srcObject = trackEvent.streams?.[0] || null;
          audio.play?.().catch?.(() => {
            if (voiceGenerationRef.current === generation) {
              setVoiceNotice("Voice is connected, but browser audio playback was blocked.");
            }
          });
        } catch {
          setVoiceNotice("Voice is connected, but browser audio playback was blocked.");
        }
      };
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      const channel = peer.createDataChannel("oai-events");
      voiceChannelRef.current = channel;
      channel.addEventListener("open", () => {
        if (voiceGenerationRef.current === generation) {
          recordApiTraceEvent(
            "realtime.connected",
            { connection_state: "open", transport: "webrtc" },
            { action: voiceTraceActionRef.current, status: "connected" },
          );
          setVoiceStatus("listening");
        }
      });
      channel.addEventListener("message", (messageEvent) => {
        try {
          handleVoiceRealtimeEvent(JSON.parse(messageEvent.data), generation);
        } catch {
          recordApiTraceEvent(
            "realtime.error",
            { error_code: "event_parse_failed", transport: "webrtc" },
            { action: voiceTraceActionRef.current, status: "failed" },
          );
          setVoiceNotice("Voice event parsing failed. Text chat is still available.");
        }
      });
      peer.onconnectionstatechange = () => {
        if (voiceGenerationRef.current !== generation) return;
        if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
          endVoiceSession("disconnected", "Voice disconnected. Text chat is still available.");
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      voiceAbortRef.current = new AbortController();
      const answerSdp = await exchangeVoiceSdp(session, offer.sdp, voiceAbortRef.current.signal);
      voiceAbortRef.current = null;
      if (voiceGenerationRef.current !== generation) return;
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      const remainingLifetime = expiresAt - now();
      if (remainingLifetime <= 0) {
        endVoiceSession("expired", "Voice expired before it connected. Text chat is still available.");
        return;
      }
      voiceExpiryRef.current = setTimeout(
        () => endVoiceSession("expired", "Voice expired. Text chat is still available."),
        remainingLifetime,
      );
    } catch (err) {
      if (voiceGenerationRef.current !== generation) return;
      const status = realtimeFailureStatus(err);
      const code = realtimeErrorCode(err);
      recordApiTraceEvent(
        "realtime.error",
        { error_code: code || "connection_failed", transport: "webrtc" },
        { action: voiceTraceActionRef.current, status: "failed" },
      );
      const notice = status === "denied"
        ? "Microphone access was denied. Text chat is still available."
        : status === "unavailable"
          ? "Voice is not supported in this browser. Text chat is still available."
          : status === "timeout"
            ? "Voice timed out before connecting. Text chat is still available."
            : "Voice could not connect. Text chat is still available.";
      endVoiceSession(status, notice);
    }
  };

  const activeVoice = voiceActiveStates.has(voiceStatus);
  const shouldShowVoice = voiceEnabled && voiceCapability;
  const voiceConfigured = voiceCapability?.configured !== false;
  const voiceDisabled = !activeVoice && (loading || !voiceConfigured);
  const voiceLabel = activeVoice ? "Stop voice" : voiceConfigured ? "Start voice" : "Voice unavailable";
  const voicePillStatus = voiceCapability?.configured === false ? "unavailable" : voiceStatus;
  const voiceCopy = voiceCapability?.configured === false
    ? voiceUnavailableCopy[voiceCapability.reason] || "Voice is unavailable. Text chat is ready."
    : voiceNotice;

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
                              {message.toolTrace.map((trace, traceIndex) => (
                                <Text key={`${trace.name}-${trace.decision}-${traceIndex}`} className="muted-mini">
                                  {capabilityDiagnosticParts(trace, { operation: trace.name, status: trace.decision }).join(" - ")}
                                </Text>
                              ))}
                            </VStack>
                          ) : null}
                        </Box>
                      ))}
                      {loading ? <Text className="chat-loading">Working...</Text> : null}
                      {voiceCopy ? <Text className="chat-loading">{voiceCopy}</Text> : null}
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
                  {shouldShowVoice ? (
                    <HStack className={`voice-compact-control ${activeVoice ? "active" : ""}`} gap={2}>
                      {activeVoice || voiceStatus !== "idle" || voiceCapability?.configured === false ? (
                        <Box className={`voice-eq-pill ${activeVoice ? "active" : voicePillStatus}`} aria-label={`Voice ${voiceStatusText(voicePillStatus)}`}>
                          <span />
                          <span />
                          <span />
                          <span />
                        </Box>
                      ) : null}
                      <IconButton
                        type="button"
                        className={`voice-composer-button ${activeVoice ? "active" : ""}`}
                        disabled={voiceDisabled}
                        onClick={activeVoice ? () => endVoiceSession("idle") : startVoice}
                        aria-label={voiceLabel}
                        title={voiceLabel}
                      >
                        {activeVoice ? <FiMicOff /> : <FiMic />}
                      </IconButton>
                    </HStack>
                  ) : null}
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
