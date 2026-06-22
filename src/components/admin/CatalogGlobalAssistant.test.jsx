import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import { queryCatalogAssistant } from "../../utils/apiClient";
import CatalogGlobalAssistant from "./CatalogGlobalAssistant";

vi.mock("../../utils/apiClient", () => ({
  queryCatalogAssistant: vi.fn(),
}));

vi.mock("./VoiceControls", () => ({
  default: ({ onResolveToolCall, onToolResult, onTranscriptEntry, onVoiceStateChange }) => (
    <button
      type="button"
      onClick={async () => {
        onVoiceStateChange?.({
          active: true,
          assistantPartial: "",
          configured: true,
          displayCopy: "Listening for questions about entire catalog and inventory.",
          entries: [{ id: "presenter-1", role: "presenter", text: "Which stores are low?" }],
          notice: "",
          presenterPartial: "",
          status: "listening",
        });
        onTranscriptEntry?.({ role: "presenter", text: "Which stores are low?" });
        onTranscriptEntry?.({ role: "assistant", text: "Dallas is low on stock." });
        onToolResult?.({
          mutation: false,
          message: "Dallas is low on stock.",
          citations: [{ kind: "inventory", source_id: "store_dallas", label: "Dallas", value: { inventory_qty: 3 } }],
        });
        await onResolveToolCall?.({
          event: {
            name: "read_inventory_status",
            arguments: JSON.stringify({ question: "Which store needs replenishment?" }),
          },
          workflowId: "workflow_1",
          idempotencyKey: "voice-tool-call",
        });
      }}
    >
      Simulate voice agent
    </button>
  ),
}));

describe("CatalogGlobalAssistant", () => {
  beforeEach(() => {
    queryCatalogAssistant.mockReset().mockResolvedValue({
      message: "Oak Brook has 7 units from the backend assistant.",
      citations: [{ kind: "inventory", source_id: "store_oak_brook", label: "Oak Brook", value: { inventory_qty: 7 } }],
      mutation: false,
    });
  });

  it("renders compact voice transcripts as normal chat turns with a live voice panel", async () => {
    renderWithProviders(
      <CatalogGlobalAssistant
        open
        onOpenChange={() => {}}
        ensureWorkflow={vi.fn().mockResolvedValue("workflow_1")}
        onWorkflowEvent={() => {}}
        realtimeCapability={{ configured: true }}
      />,
      { route: "/catalog-studio" },
    );

    await userEvent.click(screen.getByRole("button", { name: "Simulate voice agent" }));

    expect(screen.getAllByText("Which stores are low?").length).toBeGreaterThan(0);
    expect(screen.getByText("Dallas is low on stock.")).toBeInTheDocument();
    expect(screen.getByText("Realtime voice agent")).toBeInTheDocument();
    expect(screen.getByText("Catalog readout")).toBeInTheDocument();
    expect(screen.getByText("inventory: Dallas: 3 unit(s)")).toBeInTheDocument();
    expect(queryCatalogAssistant).toHaveBeenCalledWith({
      question: "Which store needs replenishment?",
      query_scopes: ["catalog", "inventory"],
    });
  });
});
