import { Badge, Box, Button, HStack, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  traceSelectionSpanId,
} from "../../utils/apiTraceProjection";
import { buildTraceGraph, TRACE_GRAPH_LAYOUT, traceSelectionNodeId } from "../../utils/apiTraceGraph";

function TraceOperationNode({ data, selected }) {
  return (
    <Box className={`trace-graph-node ${data.kind} ${data.status}${selected ? " selected" : ""}${data.changed ? " changed" : ""}`}>
      <Handle type="target" position={Position.Left} className="trace-graph-handle" />
      <HStack justify="space-between" gap={2} mb={2}>
        <span className="trace-graph-kind">{data.kind}</span>
        <Badge className={`api-trace-state ${data.status}`}>{data.status}</Badge>
      </HStack>
      <Text className="trace-graph-node-title">{data.label}</Text>
      <Text className="trace-graph-node-meta">{data.service} · {data.duration}</Text>
      {data.attempt !== null ? <Text className="trace-graph-attempt">Attempt {data.attempt}</Text> : null}
      <Handle type="source" position={Position.Right} className="trace-graph-handle" />
    </Box>
  );
}

const NODE_TYPES = { traceOperation: TraceOperationNode };

function changeSignature(node) {
  const { attempt, external, kind, label, operation, service, status } = node.data;
  return JSON.stringify({ attempt, external, kind, label, operation, service, status });
}

export default function TraceGraph({ trace, selection, onSelect }) {
  const [densityOverride, setDensityOverride] = useState("");
  const positionCache = useRef(new Map());
  const signatureCache = useRef(new Map());
  const traceId = useRef(trace?.trace_id);
  const density = densityOverride || ((trace?.spans?.length || 0) > 24 ? "compact" : "comfortable");
  const layoutDensity = useRef(density);
  const selectedNodeId = traceSelectionNodeId(trace, selection) || traceSelectionSpanId(trace, selection);
  if (traceId.current !== trace?.trace_id) {
    traceId.current = trace?.trace_id;
    positionCache.current.clear();
    signatureCache.current.clear();
  }
  if (layoutDensity.current !== density) {
    layoutDensity.current = density;
    positionCache.current.clear();
  }

  const graph = useMemo(() => buildTraceGraph(trace, { density }), [density, trace]);
  const renderedGraph = useMemo(() => {
    const occupied = new Set([...positionCache.current.values()].map((position) => `${position.x}:${position.y}`));
    const hasPrevious = signatureCache.current.size > 0;
    const nodes = graph.nodes.map((node) => {
      let position = positionCache.current.get(node.id);
      if (!position) {
        position = { ...node.position };
        while (occupied.has(`${position.x}:${position.y}`)) position.y += TRACE_GRAPH_LAYOUT[density].rowGap;
        positionCache.current.set(node.id, position);
        occupied.add(`${position.x}:${position.y}`);
      }
      const signature = changeSignature(node);
      return {
        ...node,
        position,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          changed: hasPrevious && signatureCache.current.get(node.id) !== signature,
        },
      };
    });
    return { nodes, edges: graph.edges };
  }, [density, graph, selectedNodeId]);

  useEffect(() => {
    signatureCache.current = new Map(graph.nodes.map((node) => [node.id, changeSignature(node)]));
  }, [graph]);

  if (!trace?.spans?.length) return <Text className="api-trace-empty">No spans are available for the system map.</Text>;

  return (
    <Box className={`trace-graph-shell ${density}`} aria-label="Trace system graph">
      <HStack className="trace-graph-toolbar" justify="space-between" gap={3}>
        <Box>
          <Text className="filter-label">System map</Text>
          <Text className="trace-graph-summary">{trace.spans.length} spans · {new Set(trace.spans.map((span) => span.service)).size} services</Text>
        </Box>
        <HStack gap={1} role="group" aria-label="Graph density">
          <Button type="button" size="xs" variant="ghost" className={density === "comfortable" ? "trace-density active" : "trace-density"} aria-pressed={density === "comfortable"} onClick={() => setDensityOverride("comfortable")}>Detail</Button>
          <Button type="button" size="xs" variant="ghost" className={density === "compact" ? "trace-density active" : "trace-density"} aria-pressed={density === "compact"} onClick={() => setDensityOverride("compact")}>Compact</Button>
        </HStack>
      </HStack>
      <Box className="trace-graph-canvas">
        <ReactFlow
          nodes={renderedGraph.nodes}
          edges={renderedGraph.edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, node) => {
            if (!node.data.external) {
              onSelect({
                kind: node.data.selectionKind || "span",
                id: node.data.selectionId || node.id,
              });
            }
          }}
          onPaneClick={() => onSelect({ kind: "trace", id: trace.trace_id })}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          nodesFocusable
          edgesFocusable
          deleteKeyCode={null}
          autoPanOnNodeFocus
          fitView
          fitViewOptions={{ padding: 0.28, maxZoom: 1.15 }}
          minZoom={0.2}
          maxZoom={1.6}
          onlyRenderVisibleElements={trace.spans.length > 40}
          ariaLabelConfig={{
            "node.a11yDescription.default": "Press Enter or Space to select this trace operation. Use Tab to move between operations.",
            "edge.a11yDescription.default": "Trace relationship between operations.",
          }}
        >
          <Background gap={20} size={1} color="rgba(246, 237, 220, 0.12)" />
          <MiniMap
            pannable
            zoomable
            className="trace-graph-minimap"
            aria-label="Trace graph overview"
            maskColor="rgba(10, 15, 20, 0.66)"
            nodeColor="#263746"
            nodeStrokeColor="rgba(255, 250, 240, 0.24)"
          />
          <Controls showInteractive={false} className="trace-graph-controls" />
        </ReactFlow>
      </Box>
    </Box>
  );
}
