import { recordApiTraceEvent } from "./apiTraceClient";

export const CHAT_TRANSCRIPT_MEDIA_TYPE = "application/vnd.sterling.chat-transcript+json";

const CHAT_TRANSCRIPT_TYPES = new Set([
  "chat_transcript",
  "conversation",
  "visible_chat",
]);

function dropEmptyValues(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => (
      value !== undefined
      && value !== null
      && value !== ""
      && !(Array.isArray(value) && value.length === 0)
    )),
  );
}

export function isTranscriptArtifact(artifact = {}) {
  return (
    CHAT_TRANSCRIPT_TYPES.has(artifact.artifact_type)
    || artifact.media_type === CHAT_TRANSCRIPT_MEDIA_TYPE
  );
}

export function recordVisibleConversationTurn({
  action,
  createdAt,
  messageId,
  name,
  role,
  route = "catalog_realtime_voice",
  selectedTool = "",
  source = "realtime_transcript",
  text,
  turnId,
  workflowId,
} = {}) {
  const visibleText = String(text || "").trim();
  if (!action?.enabled || !visibleText || !turnId || !messageId) return null;
  const visibleRole = role === "presenter" ? "presenter" : "assistant";
  return recordApiTraceEvent(
    "conversation.turn",
    dropEmptyValues({
      route,
      selected_tool: selectedTool,
      turn_id: turnId,
      workflow_id: workflowId,
      visible_messages: [
        dropEmptyValues({
          visible_message_id: messageId,
          visible_role: visibleRole,
          visible_text: visibleText,
          visible_source: source,
          visible_created_at: createdAt,
        }),
      ],
    }),
    {
      action,
      name: name || (visibleRole === "presenter" ? "Visible presenter transcript" : "Visible assistant transcript"),
      status: "recorded",
    },
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

function conversationTurnId(attributes = {}) {
  if (attributes.turn_id) return String(attributes.turn_id);
  if (attributes.visible_turn_id) return String(attributes.visible_turn_id);
  const messages = attributes.visible_messages || attributes.messages || [];
  const messageTurn = messages.find((message) => message.visible_turn_id || message.turn_id);
  return messageTurn ? String(messageTurn.visible_turn_id || messageTurn.turn_id) : "";
}

function mergeVisibleMessages(left = [], right = []) {
  const merged = [];
  const seen = new Set();
  [...left, ...right].forEach((message, index) => {
    const id = messageId(message, index);
    const key = `${id}:${messageRole(message)}:${messageText(message)}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(message);
  });
  return merged;
}

function mergeConversationRecords(records) {
  const result = [];
  const byTurnId = new Map();
  records.forEach((record) => {
    const turnId = conversationTurnId(record.attributes);
    if (!turnId) {
      result.push(record);
      return;
    }
    const existing = byTurnId.get(turnId);
    if (!existing) {
      byTurnId.set(turnId, record);
      result.push(record);
      return;
    }
    existing.attributes = {
      ...existing.attributes,
      ...record.attributes,
      turn_id: existing.attributes.turn_id || record.attributes.turn_id || turnId,
      visible_messages: mergeVisibleMessages(
        existing.attributes.visible_messages || existing.attributes.messages,
        record.attributes.visible_messages || record.attributes.messages,
      ),
    };
  });
  return result;
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
  const artifactTurnIds = new Set(
    artifacts.map((record) => conversationTurnId(record.attributes)).filter(Boolean),
  );
  const events = (trace?.events || [])
    .filter((event) => event.event_type === "conversation.turn")
    .filter((event) => !artifactIds.has(transcriptArtifactIdForEvent(event)))
    .filter((event) => !artifactTurnIds.has(conversationTurnId(event.attributes)))
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

  return mergeConversationRecords([...artifacts, ...events])
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
