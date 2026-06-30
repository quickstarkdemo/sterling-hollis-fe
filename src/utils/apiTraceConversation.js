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

export function conversationTurnId(attributes = {}) {
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

function compactSummaryItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => dropEmptyValues({
      action_label: item.action_label,
      action_type: item.action_type,
      capability_id: item.capability_id,
      decision: item.decision,
      product_id: item.product_id,
      status: item.status,
      title: item.title,
      tool_name: item.tool_name,
    }))
    .filter((item) => Object.keys(item).length);
}

function visibleConversationRecord(record) {
  const attributes = record.attributes || {};
  const expired = Boolean(record.expired);
  const messages = expired
    ? []
    : conversationMessages(attributes).map((message) => dropEmptyValues({
      id: message.id,
      role: message.role,
      text: message.text,
      source: message.source,
      created_at: message.createdAt,
    }));
  const projection = dropEmptyValues({
    id: record.id,
    kind: record.kind,
    name: record.name,
    type: record.type,
    media_type: record.mediaType,
    span_id: record.spanId,
    payload_state: expired ? "metadata_only" : "available",
    conversation_id: attributes.conversation_id,
    turn_id: conversationTurnId(attributes),
    workflow_id: attributes.workflow_id,
    route: attributes.route,
    selected_tool: attributes.selected_tool,
    duplicate_replay: attributes.duplicate_replay ? true : undefined,
    card_count: attributes.card_count,
    action_count: attributes.action_count,
    tool_count: attributes.tool_count,
  });
  projection.expired = expired;
  projection.message_count = messages.length;
  projection.messages = messages;
  if (!expired) {
    const cardSummaries = compactSummaryItems(attributes.card_summaries);
    const actionSummaries = compactSummaryItems(attributes.action_summaries);
    const toolTraceSummary = compactSummaryItems(attributes.tool_trace_summary);
    if (cardSummaries.length) projection.card_summaries = cardSummaries;
    if (actionSummaries.length) projection.action_summaries = actionSummaries;
    if (toolTraceSummary.length) projection.tool_trace_summary = toolTraceSummary;
  }
  return projection;
}

export function buildVisibleConversationProjection(trace) {
  const records = buildTraceConversationRecords(trace).map(visibleConversationRecord);
  const metadataOnlyCount = records.filter((record) => record.payload_state === "metadata_only").length;
  return {
    schema_version: "sterling.visible_conversation.v1",
    trace_id: trace?.trace_id || "",
    payload_state: trace?.payload_expired
      ? "metadata_only"
      : records.length
        ? "available"
        : "empty",
    record_count: records.length,
    message_count: records.reduce((total, record) => total + record.message_count, 0),
    metadata_only_count: metadataOnlyCount,
    records,
  };
}

export function traceConversationRecordForSelection(trace, selection) {
  if (!trace || !selection || (selection.kind !== "artifact" && selection.kind !== "event")) return null;
  const records = buildTraceConversationRecords(trace);
  const exact = records.find((record) => record.kind === selection.kind && record.id === selection.id);
  if (exact) return exact;
  const source = selection.kind === "artifact"
    ? trace.artifacts?.find((item) => item.artifact_id === selection.id)
    : trace.events?.find((item) => item.event_id === selection.id);
  const turnId = conversationTurnId(source?.attributes || {});
  if (!turnId) return null;
  return records.find((record) => conversationTurnId(record.attributes) === turnId) || null;
}
