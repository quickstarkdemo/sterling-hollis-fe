import { formatTraceDuration, orderTraceSpans } from "./apiTraceProjection";
import {
  buildTraceConversationRecords,
  conversationMessages,
  readableConversationRole,
  traceConversationRecordForSelection,
} from "./apiTraceConversation";

const NODE_WIDTH = 202;
export const TRACE_GRAPH_LAYOUT = {
  comfortable: { columnGap: 278, rowGap: 104 },
  compact: { columnGap: 236, rowGap: 72 },
};

function operationKind(span = {}) {
  const value = `${span.operation || ""} ${span.service || ""}`.toLowerCase();
  if (/openai|response|moderation|embedding|image/.test(value)) return "openai";
  if (/realtime|voice|websocket/.test(value)) return "realtime";
  if (/worker|queue|job|async/.test(value)) return "worker";
  if (/database|db\.|sql|persist|catalog/.test(value)) return "data";
  if (/http|fetch|request/.test(value)) return "http";
  if (/ui\.|browser|render/.test(value)) return "browser";
  return "service";
}

function spanDepth(span, spansById) {
  let depth = 0;
  let current = span;
  const visited = new Set([span.span_id]);
  while (current?.parent_span_id && depth < 12) {
    const parent = spansById.get(current.parent_span_id);
    if (!parent || visited.has(parent.span_id)) break;
    visited.add(parent.span_id);
    depth += 1;
    current = parent;
  }
  return depth;
}

function externalNodeId(link) {
  return `linked:${link.linked_trace_id}:${link.linked_span_id || "trace"}`;
}

function edgeKey(source, target, relationship) {
  return `${relationship}:${source}->${target}`;
}

function conversationPreview(record) {
  const messages = conversationMessages(record.attributes);
  const message = messages.find((item) => item.role === "assistant") || messages[0];
  if (!message?.text) return { label: record.name, messageCount: messages.length, service: "Visible transcript" };
  const text = message.text.length > 82 ? `${message.text.slice(0, 79)}...` : message.text;
  return {
    label: text,
    messageCount: messages.length,
    service: readableConversationRole(message.role),
  };
}

export function buildTraceGraph(trace, { density = "comfortable" } = {}) {
  const layout = TRACE_GRAPH_LAYOUT[density] || TRACE_GRAPH_LAYOUT.comfortable;
  const spans = orderTraceSpans(trace?.spans);
  const spansById = new Map(spans.map((span) => [span.span_id, span]));
  const layerRows = new Map();
  const nodes = spans.map((span) => {
    const depth = spanDepth(span, spansById);
    const row = layerRows.get(depth) || 0;
    layerRows.set(depth, row + 1);
    const attempt = span.attributes?.retry_attempt ?? span.attributes?.attempt ?? null;
    return {
      id: span.span_id,
      type: "traceOperation",
      position: { x: depth * layout.columnGap, y: row * layout.rowGap },
      data: {
        attempt,
        duration: formatTraceDuration(span.duration_ms),
        kind: operationKind(span),
        label: span.name,
        operation: span.operation,
        service: span.service,
        status: span.status || "running",
      },
      ariaLabel: `${span.name}, ${span.service}, ${span.status || "running"}, ${formatTraceDuration(span.duration_ms)}`,
      draggable: false,
      connectable: false,
      selectable: true,
      style: { width: NODE_WIDTH },
    };
  });

  const edgeMap = new Map();
  spans.forEach((span) => {
    if (!span.parent_span_id || !spansById.has(span.parent_span_id)) return;
    const id = edgeKey(span.parent_span_id, span.span_id, "parent");
    edgeMap.set(id, {
      id,
      source: span.parent_span_id,
      target: span.span_id,
      type: "smoothstep",
      markerEnd: "arrowclosed",
      animated: span.status === "running",
      data: { relationship: "parent" },
      ariaLabel: `${spansById.get(span.parent_span_id)?.name || "Parent"} to ${span.name}`,
    });
  });

  (trace?.links || []).forEach((link) => {
    if (!spansById.has(link.span_id)) return;
    const localTarget = link.linked_trace_id === trace.trace_id && spansById.has(link.linked_span_id)
      ? link.linked_span_id
      : null;
    const target = localTarget || externalNodeId(link);
    if (!localTarget && !nodes.some((node) => node.id === target)) {
      const source = spansById.get(link.span_id);
      const sourceDepth = spanDepth(source, spansById);
      const targetDepth = sourceDepth + 1;
      const row = layerRows.get(targetDepth) || 0;
      layerRows.set(targetDepth, row + 1);
      nodes.push({
        id: target,
        type: "traceOperation",
        position: { x: targetDepth * layout.columnGap, y: row * layout.rowGap },
        data: {
          duration: "Linked work",
          external: true,
          kind: "worker",
          label: link.attributes?.name || "Asynchronous work",
          operation: link.relationship,
          service: link.attributes?.service || link.linked_trace_id,
          status: link.attributes?.status || "linked",
        },
        ariaLabel: `Linked asynchronous work, ${link.linked_trace_id}`,
        draggable: false,
        connectable: false,
        selectable: false,
        style: { width: NODE_WIDTH },
      });
    }
    if (target === link.span_id) return;
    const relationship = link.relationship || "link";
    const id = edgeKey(link.span_id, target, relationship);
    edgeMap.set(id, {
      id,
      source: link.span_id,
      target,
      type: "smoothstep",
      markerEnd: "arrowclosed",
      className: "trace-graph-link-edge",
      data: { relationship },
      label: relationship,
      ariaLabel: `${relationship} link from ${link.span_id} to ${target}`,
    });
  });

  buildTraceConversationRecords(trace).forEach((record) => {
    if (!record.spanId || !spansById.has(record.spanId)) return;
    const source = spansById.get(record.spanId);
    const sourceDepth = spanDepth(source, spansById);
    const depth = sourceDepth + 1;
    const row = layerRows.get(depth) || 0;
    layerRows.set(depth, row + 1);
    const nodeId = `${record.kind}:${record.id}`;
    const preview = conversationPreview(record);
    nodes.push({
      id: nodeId,
      type: "traceOperation",
      position: { x: depth * layout.columnGap, y: row * layout.rowGap },
      data: {
        attempt: null,
        duration: `${preview.messageCount || 1} msg`,
        kind: "conversation",
        label: preview.label,
        operation: record.type,
        selectionId: record.id,
        selectionKind: record.kind,
        service: preview.service,
        status: record.expired ? "metadata-only" : "recorded",
      },
      ariaLabel: `${record.name}, visible conversation, ${preview.messageCount || 1} messages`,
      draggable: false,
      connectable: false,
      selectable: true,
      style: { width: NODE_WIDTH },
    });
    const relationship = "transcript";
    const id = edgeKey(record.spanId, nodeId, relationship);
    edgeMap.set(id, {
      id,
      source: record.spanId,
      target: nodeId,
      type: "smoothstep",
      markerEnd: "arrowclosed",
      className: "trace-graph-transcript-edge",
      data: { relationship },
      label: relationship,
      ariaLabel: `Visible transcript from ${record.spanId} to ${nodeId}`,
    });
  });

  return { nodes, edges: [...edgeMap.values()] };
}

export function traceSelectionNodeId(trace, selection) {
  const record = traceConversationRecordForSelection(trace, selection);
  if (record) return `${record.kind}:${record.id}`;
  return null;
}
