export const CHAT_TRANSCRIPT_MEDIA_TYPE = "application/vnd.sterling.chat-transcript+json";

const CHAT_TRANSCRIPT_TYPES = new Set([
  "chat_transcript",
  "conversation",
  "visible_chat",
]);

export function isTranscriptArtifact(artifact = {}) {
  return (
    CHAT_TRANSCRIPT_TYPES.has(artifact.artifact_type)
    || artifact.media_type === CHAT_TRANSCRIPT_MEDIA_TYPE
  );
}

function messageRole(message) {
  return message.visible_role || message.role || "message";
}

function messageText(message) {
  return message.visible_text || message.content || message.text || "";
}

function messageId(message, index) {
  return message.visible_message_id || message.message_id || `message-${index + 1}`;
}

export function conversationMessages(attributes = {}) {
  const messages = attributes.visible_messages || attributes.messages || [];
  return messages
    .map((message, index) => ({
      id: messageId(message, index),
      role: messageRole(message),
      text: messageText(message),
      source: message.visible_source || message.source || "",
      createdAt: message.visible_created_at || message.created_at || "",
    }))
    .filter((message) => message.text);
}

export function readableConversationRole(role = "") {
  if (role === "user") return "Customer";
  if (role === "assistant") return "Assistant";
  if (role === "presenter") return "Presenter";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function transcriptArtifactIdForEvent(event = {}) {
  return `transcript_${event.event_id || ""}`.slice(0, 64);
}

function timestamp(value) {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function recordTimestamp(record) {
  const messageTimes = conversationMessages(record.attributes)
    .map((message) => timestamp(message.createdAt))
    .filter((value) => value !== null);
  const fallbackTimes = [
    timestamp(record.source?.occurred_at),
    timestamp(record.source?.created_at),
  ].filter((value) => value !== null);
  const times = messageTimes.length ? messageTimes : fallbackTimes;
  return times.length ? Math.min(...times) : null;
}

export function buildTraceConversationRecords(trace) {
  const artifacts = (trace?.artifacts || [])
    .filter(isTranscriptArtifact)
    .map((artifact, index) => ({
      id: artifact.artifact_id,
      kind: "artifact",
      order: index,
      spanId: artifact.span_id,
      name: artifact.name || "Visible chat transcript",
      type: artifact.artifact_type || "chat_transcript",
      mediaType: artifact.media_type,
      attributes: artifact.attributes || {},
      expired: Boolean(trace?.payload_expired || artifact.attributes?._retention === "expired"),
      source: artifact,
    }));
  const artifactIds = new Set(artifacts.map((record) => record.id));
  const events = (trace?.events || [])
    .filter((event) => event.event_type === "conversation.turn")
    .filter((event) => !artifactIds.has(transcriptArtifactIdForEvent(event)))
    .map((event, index) => ({
      id: event.event_id,
      kind: "event",
      order: artifacts.length + index,
      spanId: event.span_id,
      name: event.name || "Visible conversation turn",
      type: event.event_type,
      mediaType: CHAT_TRANSCRIPT_MEDIA_TYPE,
      attributes: event.attributes || {},
      expired: Boolean(trace?.payload_expired || event.attributes?._retention === "expired"),
      source: event,
    }));

  return [...artifacts, ...events]
    .filter((record) => record.expired || conversationMessages(record.attributes).length)
    .sort((left, right) => {
      const leftTime = recordTimestamp(left);
      const rightTime = recordTimestamp(right);
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      if (leftTime !== null && rightTime === null) return -1;
      if (leftTime === null && rightTime !== null) return 1;
      return left.order - right.order;
    });
}
