import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import SuggestionReviewPanel from "./SuggestionReviewPanel";

const api = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn(() => "decision-key"),
  decideCatalogSuggestionSet: vi.fn(),
  getCatalogSuggestionSets: vi.fn(),
}));

vi.mock("../../utils/apiClient", () => api);

const suggestion = (overrides = {}) => ({
  id: "suggestion_description",
  section: "content",
  target_path: "/description",
  proposed_value: "A warm, supplier-grounded description.",
  baseline_value: "Original description.",
  prior_value: null,
  evidence_asset_ids: ["asset_one"],
  certainty_class: "observed",
  input_origin: "supplier_analysis",
  status: "pending",
  ...overrides,
});
const suggestionSet = (overrides = {}) => ({
  id: "set_one",
  product_id: "cat_one",
  base_draft_id: "draft_one",
  base_draft_version: 2,
  current_draft_id: "draft_one",
  current_draft_version: 2,
  status: "pending",
  suggestions: [suggestion()],
  reviews: [],
  ...overrides,
});

function renderPanel(props = {}) {
  return renderWithProviders(<SuggestionReviewPanel
    productId="cat_one"
    draft={{ revision: { id: "draft_one" }, draft_version: 2 }}
    {...props}
  />);
}

describe("SuggestionReviewPanel", () => {
  beforeEach(() => {
    api.getCatalogSuggestionSets.mockReset().mockResolvedValue({ items: [suggestionSet()] });
    api.decideCatalogSuggestionSet.mockReset();
  });

  it("renders evidence, certainty, origin, and before/after values", async () => {
    renderPanel();

    expect(await screen.findByText("description")).toBeInTheDocument();
    expect(screen.getByText("observed")).toBeInTheDocument();
    expect(screen.getByText("supplier analysis")).toBeInTheDocument();
    expect(screen.getByText("1 source")).toBeInTheDocument();
    expect(screen.getByText("Original description.")).toBeInTheDocument();
    expect(screen.getByText("A warm, supplier-grounded description.")).toBeInTheDocument();
  });

  it("accepts or rejects one proposal without bypassing the decision contract", async () => {
    const accepted = suggestion({ status: "accepted", prior_value: "Original description." });
    api.decideCatalogSuggestionSet.mockResolvedValueOnce({
      suggestion_set: suggestionSet({ status: "reviewed", current_draft_version: 3, suggestions: [accepted] }),
      draft: { draft_version: 3 },
    });
    const onDraftChanged = vi.fn();
    renderPanel({ onDraftChanged });

    await userEvent.click(await screen.findByRole("button", { name: "Accept description" }));
    expect(api.decideCatalogSuggestionSet).toHaveBeenCalledWith("cat_one", "set_one", {
      action: "accept",
      scope: "suggestion",
      suggestion_id: "suggestion_description",
      expected_draft_version: 2,
    }, "decision-key");
    expect(onDraftChanged).toHaveBeenCalled();
    expect(await screen.findByText("Suggestion accepted into a new private draft version.")).toBeInTheDocument();
  });

  it("supports atomic section acceptance for voice-origin proposals", async () => {
    api.getCatalogSuggestionSets.mockResolvedValue({ items: [suggestionSet({ suggestions: [
      suggestion({ id: "voice_description", input_origin: "voice", evidence_asset_ids: [], certainty_class: "derived" }),
      suggestion({ id: "voice_benefits", target_path: "/benefits", input_origin: "voice", evidence_asset_ids: [], certainty_class: "derived" }),
    ] })] });
    api.decideCatalogSuggestionSet.mockResolvedValue({ suggestion_set: suggestionSet({ status: "reviewed", suggestions: [] }), draft: { draft_version: 3 } });
    renderPanel();

    expect(await screen.findAllByText("voice")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Accept content section" }));
    expect(api.decideCatalogSuggestionSet).toHaveBeenCalledWith("cat_one", "set_one", {
      action: "accept", scope: "section", section: "content", expected_draft_version: 2,
    }, "decision-key");
  });

  it("rejects a proposal without creating a new draft", async () => {
    api.decideCatalogSuggestionSet.mockResolvedValue({
      suggestion_set: suggestionSet({ status: "reviewed", suggestions: [suggestion({ status: "rejected" })] }),
      draft: null,
    });
    const onDraftChanged = vi.fn();
    renderPanel({ onDraftChanged });

    await userEvent.click(await screen.findByRole("button", { name: "Reject description" }));
    expect(api.decideCatalogSuggestionSet).toHaveBeenCalledWith("cat_one", "set_one", {
      action: "reject", scope: "suggestion", suggestion_id: "suggestion_description", expected_draft_version: 2,
    }, "decision-key");
    expect(onDraftChanged).not.toHaveBeenCalled();
    expect(await screen.findByText("Suggestion rejected. The product draft was not changed.")).toBeInTheDocument();
  });

  it("blocks stale sets and preserves the current draft on conflicts", async () => {
    const stale = suggestionSet({ current_draft_version: 1 });
    api.getCatalogSuggestionSets.mockResolvedValueOnce({ items: [stale] });
    renderPanel();

    expect(await screen.findByText("stale")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept description" })).toBeDisabled();

    api.getCatalogSuggestionSets.mockResolvedValueOnce({ items: [suggestionSet()] });
    api.decideCatalogSuggestionSet.mockRejectedValueOnce({ response: { status: 409 } });
    await userEvent.click(screen.getByRole("button", { name: "Refresh product suggestions" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept description" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Accept description" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("manual edits were preserved");
  });
});
