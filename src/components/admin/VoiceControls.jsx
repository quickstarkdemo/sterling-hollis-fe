import { Badge, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiMic, FiMicOff, FiRefreshCw } from "react-icons/fi";

import {
  createCatalogRealtimeSession,
  submitCatalogRealtimeToolCall,
} from "../../utils/apiClient";
import RealtimeTranscript from "./RealtimeTranscript";

const ACTIVE_STATES = new Set(["requesting", "connecting", "listening"]);
const ALLOWED_TOOLS = new Set(["create_catalog_draft", "refine_catalog_draft"]);
const REALTIME_WEBRTC_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_TRANSCRIPT_ENTRIES = 24;
const MAX_TRANSCRIPT_CHARS = 4000;

const statusCopy = {
  idle: "Voice is off. Text controls remain available.",
  requesting: "Waiting for microphone permission…",
  connecting: "Connecting a private Realtime session…",
  listening: "Listening. Describe the product change naturally.",
  denied: "Microphone access was denied. Use text or allow microphone access and try again.",
  unavailable: "Voice is not supported in this browser. Use the text controls instead.",
  expired: "The voice session expired. Your draft is preserved; start a fresh session to continue.",
  disconnected: "Voice disconnected. Your draft is preserved and text controls remain available.",
  provider: "OpenAI Realtime is temporarily unavailable. Your draft is preserved; use text or try again.",
  timeout: "The voice session timed out before connecting. Your draft is preserved; use text or try again.",
  transport: "The browser could not complete the secure voice connection. Your draft is preserved; use text or try again.",
  error: "Voice could not connect. Your draft is preserved; use text or try again.",
};

const configurationCopy = {
  feature_disabled: "Voice is disabled in this environment. Enable Catalog Studio Realtime or continue with text.",
  missing_api_key: "Voice is not configured with an OpenAI API key. Ask an operator to update the backend environment.",
  missing_safety_secret: "Voice is missing its safety identifier secret. Ask an operator to update the backend environment.",
};

function realtimeErrorCode(error) {
  return error?.response?.data?.detail?.code || error?.message || "";
}

function defaultPeerConnection() {
  if (typeof RTCPeerConnection === "undefined") throw new Error("realtime_unsupported");
  return new RTCPeerConnection();
}

function defaultMicrophoneRequest() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("realtime_unsupported");
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

async function defaultSdpExchange(session, offerSdp, signal) {
  if (session.webrtc_url !== REALTIME_WEBRTC_URL) throw new Error("realtime_invalid_url");
  const response = await fetch(session.webrtc_url, {
    method: "POST",
    body: offerSdp,
    signal,
    headers: {
      Authorization: `Bearer ${session.client_secret}`,
      "Content-Type": "application/sdp",
    },
  });
  if (!response.ok) throw new Error("realtime_connection_failed");
  return response.text();
}

function toolOutput(result) {
  return JSON.stringify({
    status: result?.status || "failed",
    message: result?.message || "The draft tool finished.",
    retryable: Boolean(result?.retryable),
  });
}

function voiceIdempotencyKey(callId) {
  if (/^[A-Za-z0-9_-]{1,117}$/.test(callId)) return `voice-tool-${callId}`;
  let hash = 2166136261;
  for (let index = 0; index < callId.length; index += 1) {
    hash = Math.imul(hash ^ callId.charCodeAt(index), 16777619);
  }
  const prefix = encodeURIComponent(callId).slice(0, 100);
  return `voice-tool-${prefix}-${(hash >>> 0).toString(16)}`;
}

export default function VoiceControls({
  workflowId,
  disabled = false,
  realtimeCapability,
  ensureWorkflow,
  onToolResult,
  onWorkflowEvent,
  resetSignal = 0,
  createPeerConnection = defaultPeerConnection,
  requestMicrophone = defaultMicrophoneRequest,
  exchangeSdp = defaultSdpExchange,
  now = () => Date.now(),
}) {
  const [status, setStatus] = useState("idle");
  const [notice, setNotice] = useState("");
  const [entries, setEntries] = useState([]);
  const [presenterPartial, setPresenterPartial] = useState("");
  const [assistantPartial, setAssistantPartial] = useState("");
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const expiryRef = useRef(null);
  const abortRef = useRef(null);
  const generationRef = useRef(0);
  const handledCallsRef = useRef(new Set());
  const presenterPartialRef = useRef("");
  const assistantPartialRef = useRef("");
  const entrySequenceRef = useRef(0);
  const resetSignalRef = useRef(resetSignal);
  const callbacksRef = useRef({ onToolResult, onWorkflowEvent });
  callbacksRef.current = { onToolResult, onWorkflowEvent };

  const clearResources = useCallback(() => {
    if (expiryRef.current) clearTimeout(expiryRef.current);
    expiryRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    channelRef.current?.close?.();
    peerRef.current?.close?.();
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    if (audioRef.current) audioRef.current.srcObject = null;
    channelRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    audioRef.current = null;
  }, []);

  const endSession = useCallback((nextStatus, nextNotice = "") => {
    generationRef.current += 1;
    clearResources();
    setStatus(nextStatus);
    setNotice(nextNotice);
  }, [clearResources]);

  useEffect(() => () => {
    generationRef.current += 1;
    clearResources();
  }, [clearResources]);

  useEffect(() => {
    if (resetSignalRef.current === resetSignal) return;
    resetSignalRef.current = resetSignal;
    endSession("idle");
  }, [endSession, resetSignal]);

  useEffect(() => {
    if (disabled && ACTIVE_STATES.has(status)) endSession("idle");
  }, [disabled, endSession, status]);

  const completeTranscript = (role, text) => {
    const normalized = String(text || "").trim();
    if (!normalized) return;
    entrySequenceRef.current += 1;
    setEntries((current) => [
      ...current,
      { id: `${role}-${entrySequenceRef.current}`, role, text: normalized.slice(-MAX_TRANSCRIPT_CHARS) },
    ].slice(-MAX_TRANSCRIPT_ENTRIES));
    if (role === "presenter") {
      presenterPartialRef.current = "";
      setPresenterPartial("");
    } else {
      assistantPartialRef.current = "";
      setAssistantPartial("");
    }
  };

  const sendEvent = (event) => {
    if (channelRef.current?.readyState === "open") channelRef.current.send(JSON.stringify(event));
  };

  const executeToolCall = async (event, activeWorkflowId, generation) => {
    const callId = String(event.call_id || "");
    if (!callId || handledCallsRef.current.has(callId)) return;
    handledCallsRef.current.add(callId);

    try {
      if (!ALLOWED_TOOLS.has(event.name)) throw new Error("unsupported_tool");
      const argumentsPayload = JSON.parse(event.arguments || "{}");
      const result = await submitCatalogRealtimeToolCall(activeWorkflowId, {
        call_id: callId,
        name: event.name,
        arguments: argumentsPayload,
      }, voiceIdempotencyKey(callId));
      if (generationRef.current !== generation) return;
      callbacksRef.current.onToolResult?.(result, activeWorkflowId);
      callbacksRef.current.onWorkflowEvent?.(activeWorkflowId);
      sendEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: toolOutput(result) },
      });
      sendEvent({ type: "response.create" });
    } catch {
      if (generationRef.current !== generation) return;
      setNotice("The voice command could not update the draft. Nothing was lost; continue with text or try speaking again.");
      callbacksRef.current.onWorkflowEvent?.(activeWorkflowId);
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ status: "failed", message: "The draft command was not applied.", retryable: true }),
        },
      });
      sendEvent({ type: "response.create" });
    }
  };

  const handleRealtimeEvent = (event, activeWorkflowId, generation) => {
    if (generationRef.current !== generation) return;
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        presenterPartialRef.current = `${presenterPartialRef.current}${event.delta || ""}`.slice(-MAX_TRANSCRIPT_CHARS);
        setPresenterPartial(presenterPartialRef.current);
        break;
      case "conversation.item.input_audio_transcription.completed":
        completeTranscript("presenter", event.transcript || presenterPartialRef.current);
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        assistantPartialRef.current = `${assistantPartialRef.current}${event.delta || ""}`.slice(-MAX_TRANSCRIPT_CHARS);
        setAssistantPartial(assistantPartialRef.current);
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        completeTranscript("assistant", event.transcript || assistantPartialRef.current);
        break;
      case "response.function_call_arguments.done":
        void executeToolCall(event, activeWorkflowId, generation);
        break;
      case "error":
        endSession("error");
        break;
      default:
        break;
    }
  };

  const startSession = async () => {
    if (disabled || realtimeCapability?.configured === false || ACTIVE_STATES.has(status)) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    clearResources();
    handledCallsRef.current = new Set();
    setNotice("");
    setEntries([]);
    presenterPartialRef.current = "";
    assistantPartialRef.current = "";
    setPresenterPartial("");
    setAssistantPartial("");
    setStatus("requesting");

    try {
      const stream = await requestMicrophone();
      if (generationRef.current !== generation) {
        stream.getTracks?.().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setStatus("connecting");
      const activeWorkflowId = workflowId || await ensureWorkflow?.();
      if (generationRef.current !== generation) return;
      if (!activeWorkflowId) throw new Error("workflow_unavailable");
      const session = await createCatalogRealtimeSession(activeWorkflowId);
      if (generationRef.current !== generation) return;
      callbacksRef.current.onWorkflowEvent?.(activeWorkflowId);

      const expiresAt = Number(session.expires_at) * 1000;
      if (expiresAt - now() <= 0) {
        endSession("expired");
        return;
      }

      const peer = createPeerConnection();
      peerRef.current = peer;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;
      peer.ontrack = (trackEvent) => {
        if (generationRef.current === generation) audio.srcObject = trackEvent.streams?.[0] || null;
      };
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.addEventListener("open", () => {
        if (generationRef.current === generation) setStatus("listening");
      });
      channel.addEventListener("message", (messageEvent) => {
        try {
          handleRealtimeEvent(JSON.parse(messageEvent.data), activeWorkflowId, generation);
        } catch {
          setNotice("A voice event could not be read. The session remains available.");
        }
      });
      peer.onconnectionstatechange = () => {
        if (generationRef.current !== generation) return;
        if (["failed", "disconnected", "closed"].includes(peer.connectionState)) endSession("disconnected");
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      abortRef.current = new AbortController();
      const answerSdp = await exchangeSdp(session, offer.sdp, abortRef.current.signal);
      abortRef.current = null;
      if (generationRef.current !== generation) return;
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      const remainingLifetime = expiresAt - now();
      if (remainingLifetime <= 0) {
        endSession("expired");
        return;
      }
      expiryRef.current = setTimeout(() => endSession("expired"), remainingLifetime);
    } catch (error) {
      if (generationRef.current !== generation) return;
      const code = realtimeErrorCode(error);
      const unsupported = code === "realtime_unsupported";
      const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
      const nextStatus = unsupported
        ? "unavailable"
        : denied
          ? "denied"
          : code === "realtime_timeout"
            ? "timeout"
            : ["realtime_unavailable", "realtime_failed"].includes(code)
              ? "provider"
              : ["realtime_invalid_url", "realtime_connection_failed"].includes(code)
                ? "transport"
                : "error";
      endSession(nextStatus);
    }
  };

  const active = ACTIVE_STATES.has(status);
  const configurationUnavailable = realtimeCapability?.configured === false;
  const displayStatus = configurationUnavailable ? "unavailable" : status;
  const displayCopy = configurationUnavailable
    ? configurationCopy[realtimeCapability.reason] || "Voice is not configured in this environment. Use text or ask an operator to review the backend settings."
    : statusCopy[status];

  return (
    <Box className="voice-controls">
      <HStack justify="space-between" gap={3} flexWrap="wrap">
        <Box>
          <HStack gap={2}>
            <Text className="filter-label">Voice input</Text>
            <Badge className={`workflow-status ${displayStatus === "listening" ? "running" : displayStatus}`}>{displayStatus}</Badge>
          </HStack>
          <Text className="muted-text">{displayCopy}</Text>
        </Box>
        {active ? (
          <Button type="button" className="secondary-button" onClick={() => endSession("idle")}>
            <FiMicOff /> Stop voice
          </Button>
        ) : (
          <Button type="button" className="secondary-button" disabled={disabled || configurationUnavailable} onClick={startSession}>
            {status === "idle" ? <FiMic /> : <FiRefreshCw />} {status === "idle" ? "Start voice" : "Start fresh session"}
          </Button>
        )}
      </HStack>
      {notice ? <Text className="catalog-action-hint" mt={3}>{notice}</Text> : null}
      <VStack align="stretch" mt={4}>
        <RealtimeTranscript
          entries={entries}
          presenterPartial={presenterPartial}
          assistantPartial={assistantPartial}
        />
      </VStack>
    </Box>
  );
}
