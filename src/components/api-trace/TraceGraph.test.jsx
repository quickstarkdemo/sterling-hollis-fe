import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import { buildTraceGraph } from "../../utils/apiTraceGraph";
import TraceGraph from "./TraceGraph";

vi.mock("@xyflow/react", () => ({
  Background: ({ color }) => <div data-testid="graph-background" data-color={color} />,
  Controls: () => <div data-testid="graph-controls" />,
  Handle: () => null,
  MiniMap: ({ maskColor, nodeColor, nodeStrokeColor }) => (
    <div
      data-testid="graph-minimap"
      data-mask-color={maskColor}
      data-node-color={nodeColor}
      data-node-stroke-color={nodeStrokeColor}
    />
  ),
  Position: { Left: "left", Right: "right" },
  ReactFlow: ({ nodes, edges, onNodeClick, children, nodesFocusable, edgesFocusable }) => (
    <div data-testid="react-flow" data-nodes-focusable={String(nodesFocusable)} data-edges-focusable={String(edgesFocusable)}>
      {nodes.map((node) => (
        <button
          type="button"
          key={node.id}
          aria-label={node.ariaLabel}
          data-position={`${node.position.x}:${node.position.y}`}
          data-selected={String(node.selected)}
          onClick={() => onNodeClick({}, node)}
        >{node.data.label}</button>
      ))}
      {edges.map((edge) => <span key={edge.id} data-testid="graph-edge">{edge.id}</span>)}
      {children}
    </div>
  ),
}));

const span = (spanId, parentSpanId, name, start, extra = {}) => ({
  span_id: spanId,
  parent_span_id: parentSpanId,
  name,
  operation: "http.request",
  service: "catalog-api",
  status: "completed",
  started_at: `2026-06-20T00:00:0${start}Z`,
  duration_ms: 100,
  attributes: {},
  ...extra,
});

const trace = {
  trace_id: "trace-1",
  spans: [
    span("root", null, "Browser action", 0, { operation: "ui.action", service: "browser" }),
    span("request", "root", "Draft request", 1),
    span("openai", "request", "Responses API", 2, { operation: "openai.responses", attributes: { retry_attempt: 2 } }),
    span("persist", "request", "Persist draft", 3, { operation: "db.write" }),
    span("orphan", "missing", "Partial worker", 4, { operation: "worker.job", status: "running" }),
  ],
  links: [
    { link_id: "link-1", span_id: "openai", linked_trace_id: "trace-1", linked_span_id: "persist", relationship: "follows" },
    { link_id: "link-2", span_id: "request", linked_trace_id: "worker-trace", linked_span_id: "job-1", relationship: "async", attributes: { name: "Image worker" } },
    { link_id: "link-3", span_id: "request", linked_trace_id: "worker-trace", linked_span_id: "job-1", relationship: "async", attributes: { name: "Image worker" } },
  ],
  events: [{ event_id: "event-1", span_id: "openai", sequence: 1 }],
  artifacts: [],
};

function IncrementalGraph() {
  const [current, setCurrent] = useState(trace);
  return (
    <>
      <button type="button" onClick={() => setCurrent((value) => ({ ...value, spans: [...value.spans, span("late", "request", "Late event span", 5)] }))}>Add late span</button>
      <TraceGraph trace={current} selection={null} onSelect={() => {}} />
    </>
  );
}

describe("buildTraceGraph", () => {
  it("produces deterministic trees, fan-out, links, retries, and partial nodes", () => {
    const first = buildTraceGraph(trace);
    const second = buildTraceGraph(trace);
    expect(first).toEqual(second);
    expect(first.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "root", "request", "openai", "persist", "orphan", "linked:worker-trace:job-1",
    ]));
    expect(first.nodes.find((node) => node.id === "openai")?.data.attempt).toBe(2);
    expect(first.nodes.find((node) => node.id === "orphan")?.position.x).toBe(0);
    expect(Math.max(...first.nodes.map((node) => node.position.y))).toBeLessThanOrEqual(208);
    expect(first.edges.map((edge) => edge.id)).toEqual(expect.arrayContaining([
      "parent:root->request",
      "parent:request->openai",
      "parent:request->persist",
      "follows:openai->persist",
      "async:request->linked:worker-trace:job-1",
    ]));
    expect(new Set(first.edges.map((edge) => edge.id)).size).toBe(first.edges.length);
  });

  it("adds visible transcript nodes and deduplicates event-backed artifacts", () => {
    const conversationEvent = {
      event_id: "turn-1",
      span_id: "openai",
      sequence: 2,
      name: "Visible assistant transcript",
      event_type: "conversation.turn",
      attributes: {
        visible_messages: [
          { visible_role: "assistant", visible_text: "Dallas is low on stock." },
        ],
      },
    };
    const liveGraph = buildTraceGraph({ ...trace, events: [...trace.events, conversationEvent] });

    expect(liveGraph.nodes.find((node) => node.id === "event:turn-1")?.data.kind).toBe("conversation");
    expect(liveGraph.nodes.find((node) => node.id === "event:turn-1")?.data.label).toBe("Dallas is low on stock.");
    expect(liveGraph.edges.map((edge) => edge.id)).toContain("transcript:openai->event:turn-1");

    const reloadedGraph = buildTraceGraph({
      ...trace,
      events: [...trace.events, conversationEvent],
      artifacts: [{
        artifact_id: "transcript_turn-1",
        span_id: "openai",
        artifact_type: "chat_transcript",
        name: "Visible assistant transcript artifact",
        media_type: "application/vnd.sterling.chat-transcript+json",
        attributes: conversationEvent.attributes,
      }],
    });
    expect(reloadedGraph.nodes.some((node) => node.id === "event:turn-1")).toBe(false);
    expect(reloadedGraph.nodes.some((node) => node.id === "artifact:transcript_turn-1")).toBe(true);

    const durableTurnGraph = buildTraceGraph({
      ...trace,
      events: [...trace.events, {
        ...conversationEvent,
        attributes: {
          ...conversationEvent.attributes,
          turn_id: "voice-turn-1",
        },
      }],
      artifacts: [{
        artifact_id: "artifact-server-realtime-turn",
        span_id: "openai",
        artifact_type: "chat_transcript",
        name: "Visible realtime transcript artifact",
        media_type: "application/vnd.sterling.chat-transcript+json",
        attributes: {
          ...conversationEvent.attributes,
          turn_id: "voice-turn-1",
        },
      }],
    });
    expect(durableTurnGraph.nodes.some((node) => node.id === "event:turn-1")).toBe(false);
    expect(durableTurnGraph.nodes.some((node) => node.id === "artifact:artifact-server-realtime-turn")).toBe(true);
  });
});

describe("TraceGraph", () => {
  it("synchronizes event selection with a graph node and graph selection with the inspector store", () => {
    const onSelect = vi.fn();
    renderWithProviders(<TraceGraph trace={trace} selection={{ kind: "event", id: "event-1" }} onSelect={onSelect} />);

    const openai = screen.getByRole("button", { name: /Responses API/ });
    expect(openai).toHaveAttribute("data-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: /Persist draft/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "span", id: "persist" });
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-nodes-focusable", "true");
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-edges-focusable", "true");
    expect(screen.getByTestId("graph-background")).toHaveAttribute("data-color", "rgba(246, 237, 220, 0.12)");
    expect(screen.getByTestId("graph-minimap")).toHaveAttribute("data-mask-color", "rgba(10, 15, 20, 0.66)");
    expect(screen.getByTestId("graph-minimap")).toHaveAttribute("data-node-color", "#263746");
  });

  it("selects conversation transcript graph nodes as events", () => {
    const onSelect = vi.fn();
    const conversationTrace = {
      ...trace,
      events: [
        ...trace.events,
        {
          event_id: "turn-1",
          span_id: "openai",
          sequence: 2,
          name: "Visible assistant transcript",
          event_type: "conversation.turn",
          attributes: {
            visible_messages: [
              { visible_role: "assistant", visible_text: "Dallas is low on stock." },
            ],
          },
        },
      ],
    };
    renderWithProviders(<TraceGraph trace={conversationTrace} selection={{ kind: "event", id: "turn-1" }} onSelect={onSelect} />);

    const transcriptNode = screen.getByRole("button", { name: /Visible assistant transcript/ });
    expect(transcriptNode).toHaveAttribute("data-selected", "true");
    fireEvent.click(transcriptNode);
    expect(onSelect).toHaveBeenCalledWith({ kind: "event", id: "turn-1" });
  });

  it("selects the durable transcript artifact after live turns are deduped", () => {
    const onSelect = vi.fn();
    const conversationEvent = {
      event_id: "turn-1",
      span_id: "openai",
      sequence: 2,
      name: "Visible assistant transcript",
      event_type: "conversation.turn",
      attributes: {
        turn_id: "voice-turn-1",
        visible_messages: [
          { visible_role: "assistant", visible_text: "Dallas is low on stock." },
        ],
      },
    };
    const conversationTrace = {
      ...trace,
      events: [...trace.events, conversationEvent],
      artifacts: [{
        artifact_id: "artifact-server-realtime-turn",
        span_id: "openai",
        artifact_type: "chat_transcript",
        name: "Visible realtime transcript artifact",
        media_type: "application/vnd.sterling.chat-transcript+json",
        attributes: conversationEvent.attributes,
      }],
    };
    renderWithProviders(<TraceGraph trace={conversationTrace} selection={{ kind: "event", id: "turn-1" }} onSelect={onSelect} />);

    const transcriptNode = screen.getByRole("button", { name: /Visible realtime transcript artifact/ });
    expect(transcriptNode).toHaveAttribute("data-selected", "true");
    fireEvent.click(transcriptNode);
    expect(onSelect).toHaveBeenCalledWith({ kind: "artifact", id: "artifact-server-realtime-turn" });
  });

  it("keeps existing positions stable across incremental updates and exposes compact density", () => {
    renderWithProviders(<IncrementalGraph />);
    const rootPosition = screen.getByRole("button", { name: /Browser action/ }).getAttribute("data-position");
    fireEvent.click(screen.getByRole("button", { name: "Add late span" }));
    expect(screen.getByRole("button", { name: /Browser action/ })).toHaveAttribute("data-position", rootPosition);
    const latePosition = screen.getByRole("button", { name: /Late event span/ }).getAttribute("data-position");

    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Late event span/ })).not.toHaveAttribute("data-position", latePosition);
  });

  it("automatically uses compact density without hiding nodes in large traces", () => {
    const spans = Array.from({ length: 30 }, (_, index) => span(`span-${index}`, index ? `span-${index - 1}` : null, `Operation ${index}`, index % 10));
    renderWithProviders(<TraceGraph trace={{ ...trace, spans, links: [] }} selection={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /Operation/ })).toHaveLength(30);
  });
});
