import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import CatalogGlobalAssistant from "./CatalogGlobalAssistant";

vi.mock("../../utils/apiClient", () => ({
  queryCatalogAssistant: vi.fn(),
}));

vi.mock("./VoiceControls", () => ({
  default: ({ onToolResult, onTranscriptEntry, onVoiceStateChange }) => (
    <button
      type="button"
      onClick={() => {
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
      }}
    >
      Simulate voice agent
    </button>
  ),
}));

describe("CatalogGlobalAssistant", () => {
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
  });
});
