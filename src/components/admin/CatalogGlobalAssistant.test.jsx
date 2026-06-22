import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import CatalogGlobalAssistant from "./CatalogGlobalAssistant";

vi.mock("../../utils/apiClient", () => ({
  queryCatalogAssistant: vi.fn(),
}));

vi.mock("./VoiceControls", () => ({
  default: ({ onTranscriptEntry }) => (
    <button
      type="button"
      onClick={() => {
        onTranscriptEntry?.({ role: "presenter", text: "Which stores are low?" });
        onTranscriptEntry?.({ role: "assistant", text: "Dallas is low on stock." });
      }}
    >
      Simulate voice transcript
    </button>
  ),
}));

describe("CatalogGlobalAssistant", () => {
  it("renders compact voice transcripts as normal chat turns", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: "Simulate voice transcript" }));

    expect(screen.getByText("Which stores are low?")).toBeInTheDocument();
    expect(screen.getByText("Dallas is low on stock.")).toBeInTheDocument();
  });
});
