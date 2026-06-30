import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import TraceConversationView from "./TraceConversationView";

const transcriptArtifact = {
  artifact_id: "artifact-chat",
  span_id: "span-chat",
  artifact_type: "chat_transcript",
  name: "Visible storefront chat transcript",
  media_type: "application/vnd.sterling.chat-transcript+json",
  size_bytes: 680,
  attributes: {
    conversation_id: "conv_1",
    turn_id: "turn_1",
    route: "simple_tool",
    intent: "product_question",
    selected_tool: "product_detail",
    card_count: 1,
    action_count: 1,
    tool_count: 2,
    visible_messages: [
      {
        visible_role: "user",
        visible_text: "Does this jacket work for rain?",
        visible_message_id: "msg_user",
      },
      {
        visible_role: "assistant",
        visible_text: "Yes. The shell is water resistant and has sealed seams.",
        visible_message_id: "msg_assistant",
      },
    ],
    card_summaries: [{ product_id: "cat_1", title: "Trail Shell" }],
    action_summaries: [{ action_type: "view_product", action_label: "View Trail Shell" }],
    tool_trace_summary: [
      { tool_name: "product_detail", decision: "answered from product detail" },
      { tool_name: "capability", decision: "capability_id=shopper.chat.product_detail" },
    ],
  },
};

const transcriptEvent = {
  event_id: "voice-turn-1",
  span_id: "span-chat",
  sequence: 4,
  name: "Visible assistant transcript",
  event_type: "conversation.turn",
  status: "recorded",
  occurred_at: "2026-06-20T00:00:04Z",
  attributes: {
    route: "catalog_realtime_voice",
    workflow_id: "workflow_1",
    visible_messages: [
      {
        visible_role: "presenter",
        visible_text: "Which stores are low?",
        visible_message_id: "voice_user",
      },
      {
        visible_role: "assistant",
        visible_text: "Dallas Downtown is low on stock.",
        visible_message_id: "voice_assistant",
      },
    ],
  },
};

describe("TraceConversationView", () => {
  it("renders a helpful empty state when no transcript artifact exists", () => {
    renderWithProviders(<TraceConversationView trace={{ artifacts: [], events: [] }} />);
    expect(screen.getByText(/No visible chat transcript/)).toBeInTheDocument();
  });

  it("renders metadata-only state when transcript payloads have expired", () => {
    renderWithProviders(
      <TraceConversationView
        trace={{
          payload_expired: true,
          artifacts: [{ ...transcriptArtifact, attributes: { _retention: "expired" } }],
        }}
      />,
    );
    expect(screen.getByText(/Transcript payload has expired/)).toBeInTheDocument();
  });

  it("renders visible chat and selects the backing artifact", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <TraceConversationView
        trace={{ artifacts: [transcriptArtifact] }}
        selection={null}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Conversation conv_1")).toBeInTheDocument();
    expect(screen.getByText("Does this jacket work for rain?")).toBeInTheDocument();
    expect(screen.getByText(/water resistant/)).toBeInTheDocument();
    expect(screen.getByText("Trail Shell")).toBeInTheDocument();
    expect(screen.getByText("View Trail Shell")).toBeInTheDocument();
    expect(screen.getAllByText("product_detail").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Customer Does this jacket/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "artifact", id: "artifact-chat" });
  });

  it("renders live conversation events and selects the backing event", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <TraceConversationView
        trace={{ artifacts: [], events: [transcriptEvent] }}
        selection={{ kind: "event", id: "voice-turn-1" }}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("catalog_realtime_voice")).toBeInTheDocument();
    expect(screen.getByText("Which stores are low?")).toBeInTheDocument();
    expect(screen.getByText("Dallas Downtown is low on stock.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Presenter Which stores/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "event", id: "voice-turn-1" });
  });

  it("deduplicates event turns once their derived transcript artifact arrives", () => {
    renderWithProviders(
      <TraceConversationView
        trace={{
          events: [transcriptEvent],
          artifacts: [{
            ...transcriptArtifact,
            artifact_id: "transcript_voice-turn-1",
            name: "Visible realtime transcript artifact",
            attributes: transcriptEvent.attributes,
          }],
        }}
      />,
    );

    expect(screen.getAllByText("Which stores are low?")).toHaveLength(1);
  });

  it("can render transcript messages without a selection handler", () => {
    renderWithProviders(<TraceConversationView trace={{ artifacts: [transcriptArtifact] }} />);

    expect(() => {
      fireEvent.click(screen.getByRole("button", { name: /Customer Does this jacket/ }));
    }).not.toThrow();
  });
});
