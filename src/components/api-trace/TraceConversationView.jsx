import { Badge, Box, Text } from "@chakra-ui/react";

import {
  buildTraceConversationRecords,
  conversationMessages,
  readableConversationRole,
} from "../../utils/apiTraceConversation";

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
  const records = buildTraceConversationRecords(trace);
  if (trace?.payload_expired && !records.length) {
    return (
      <Box className="api-trace-notice metadata-only">
        Transcript details have expired. Timing and metadata remain available.
      </Box>
    );
  }

  if (!records.length) {
    return <Text className="api-trace-empty">No visible chat transcript is attached to this trace yet.</Text>;
  }

  return (
    <Box className="trace-conversation-list" aria-label="Trace chat transcripts">
      {records.map((record) => {
        const selected = selection?.kind === record.kind && selection.id === record.id;
        const attributes = record.attributes || {};
        const messages = conversationMessages(attributes);
        return (
          <Box
            key={`${record.kind}-${record.id}`}
            className={`trace-conversation-card${selected ? " selected" : ""}`}
          >
            <Box className="trace-conversation-heading">
              <Box minW={0}>
                <Text className="section-kicker">Visible conversation</Text>
                <Text className="panel-title">{record.name}</Text>
              </Box>
              <Badge className="api-trace-artifact-type">{record.type}</Badge>
            </Box>

            <Box className="trace-conversation-meta">
              {attributes.conversation_id ? <span>Conversation {attributes.conversation_id}</span> : null}
              {attributes.turn_id ? <span>Turn {attributes.turn_id}</span> : null}
              {attributes.route ? <span>{attributes.route}</span> : null}
              {attributes.selected_tool ? <span>{attributes.selected_tool}</span> : null}
              {attributes.duplicate_replay ? <span>Replay</span> : null}
            </Box>

            {record.expired ? (
              <Box className="api-trace-notice metadata-only">
                Transcript payload has expired. Metadata for this item is still available in the inspector.
              </Box>
            ) : (
              <>
                <Box className="trace-message-list">
                  {messages.map((message) => (
                    <button
                      type="button"
                      key={`${record.kind}-${record.id}-${message.id}-${message.role}`}
                      className={`trace-message ${message.role}${selected ? " selected" : ""}`}
                      onClick={() => onSelect?.({ kind: record.kind, id: record.id })}
                    >
                      <span className="trace-message-role">{readableConversationRole(message.role)}</span>
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
