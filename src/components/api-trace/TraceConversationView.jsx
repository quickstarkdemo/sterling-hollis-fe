import { Badge, Box, Text } from "@chakra-ui/react";

const CHAT_TRANSCRIPT_TYPES = new Set([
  "chat_transcript",
  "conversation",
  "visible_chat",
]);

function transcriptArtifacts(trace) {
  return (trace?.artifacts || []).filter((artifact) => (
    CHAT_TRANSCRIPT_TYPES.has(artifact.artifact_type)
    || artifact.media_type === "application/vnd.sterling.chat-transcript+json"
  ));
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

function conversationMessages(attributes = {}) {
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

function artifactExpired(trace, artifact) {
  return trace?.payload_expired || artifact?.attributes?._retention === "expired";
}

function readableRole(role) {
  if (role === "user") return "Customer";
  if (role === "assistant") return "Assistant";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function SummarySection({ title, count, items = [], renderItem }) {
  if (!count && !items.length) return null;
  return (
    <Box className="trace-conversation-summary-section">
      <Text className="filter-label">{title}</Text>
      {count ? <Badge className="trace-summary-count">{count}</Badge> : null}
      {items.length ? (
        <Box className="trace-summary-list">
          {items.map((item, index) => (
            <span key={`${title}-${index}`}>{renderItem(item)}</span>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export default function TraceConversationView({ trace, selection, onSelect }) {
  if (trace?.payload_expired && !(trace?.artifacts || []).length) {
    return (
      <Box className="api-trace-notice metadata-only">
        Transcript details have expired. Timing and artifact metadata remain available.
      </Box>
    );
  }

  const artifacts = transcriptArtifacts(trace);
  if (!artifacts.length) {
    return <Text className="api-trace-empty">No customer-visible chat transcript is attached to this trace.</Text>;
  }

  return (
    <Box className="trace-conversation-list" aria-label="Trace chat transcripts">
      {artifacts.map((artifact) => {
        const selected = selection?.kind === "artifact" && selection.id === artifact.artifact_id;
        const attributes = artifact.attributes || {};
        const messages = conversationMessages(attributes);
        const expired = artifactExpired(trace, artifact);
        return (
          <Box
            key={artifact.artifact_id}
            className={`trace-conversation-card${selected ? " selected" : ""}`}
          >
            <Box className="trace-conversation-heading">
              <Box minW={0}>
                <Text className="section-kicker">Customer conversation</Text>
                <Text className="panel-title">{artifact.name || "Visible chat transcript"}</Text>
              </Box>
              <Badge className="api-trace-artifact-type">{artifact.artifact_type}</Badge>
            </Box>

            <Box className="trace-conversation-meta">
              {attributes.conversation_id ? <span>Conversation {attributes.conversation_id}</span> : null}
              {attributes.turn_id ? <span>Turn {attributes.turn_id}</span> : null}
              {attributes.route ? <span>{attributes.route}</span> : null}
              {attributes.selected_tool ? <span>{attributes.selected_tool}</span> : null}
              {attributes.duplicate_replay ? <span>Replay</span> : null}
            </Box>

            {expired ? (
              <Box className="api-trace-notice metadata-only">
                Transcript payload has expired. Metadata for this artifact is still available in the inspector.
              </Box>
            ) : (
              <>
                <Box className="trace-message-list">
                  {messages.map((message) => (
                    <button
                      type="button"
                      key={`${artifact.artifact_id}-${message.id}-${message.role}`}
                      className={`trace-message ${message.role}${selected ? " selected" : ""}`}
                      onClick={() => onSelect?.({ kind: "artifact", id: artifact.artifact_id })}
                    >
                      <span className="trace-message-role">{readableRole(message.role)}</span>
                      <span className="trace-message-text">{message.text}</span>
                    </button>
                  ))}
                </Box>

                <Box className="trace-conversation-summary">
                  <SummarySection
                    title="Cards"
                    count={attributes.card_count}
                    items={attributes.card_summaries}
                    renderItem={(item) => item.title || item.product_id || "Product card"}
                  />
                  <SummarySection
                    title="Actions"
                    count={attributes.action_count}
                    items={attributes.action_summaries}
                    renderItem={(item) => item.action_label || item.action_type || "Action"}
                  />
                  <SummarySection
                    title="Tool path"
                    count={attributes.tool_count}
                    items={attributes.tool_trace_summary}
                    renderItem={(item) => item.tool_name || item.decision || "Tool decision"}
                  />
                </Box>
              </>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
