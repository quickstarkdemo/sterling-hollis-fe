import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductReviewPanel from "./ProductReviewPanel";

const api = vi.hoisted(() => ({
  assistCatalogProductReview: vi.fn(),
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  decideCatalogProductReview: vi.fn(),
  getAdminCatalogProductReviews: vi.fn(),
}));

vi.mock("../../utils/apiClient", () => api);

const baseReview = {
  id: "review_one",
  product_id: "cat_coat",
  source: "synthetic_fixture",
  external_review_id: "supplier-review-one",
  author_display_name: "Maya R.",
  body: "The material feels substantial and the finish is beautiful.",
  rating: 5,
  submitted_at: "2026-06-19T12:00:00Z",
  moderation: {
    version: 1,
    state: "pending",
    ai_categories: [],
    ai_theme_summary: null,
    ai_suggested_action: null,
    ai_provider_metadata: {},
    response_draft: null,
    response_published: null,
    response_published_at: null,
    decided_by: null,
    decided_at: null,
    decision_reason: null,
  },
  actions: [],
};

function nextReview(changes = {}) {
  return {
    ...baseReview,
    ...changes,
    moderation: { ...baseReview.moderation, ...(changes.moderation || {}) },
  };
}

describe("ProductReviewPanel", () => {
  beforeEach(() => {
    api.createIdempotencyKey.mockClear();
    api.getAdminCatalogProductReviews.mockReset().mockResolvedValue({ items: [baseReview] });
    api.assistCatalogProductReview.mockReset();
    api.decideCatalogProductReview.mockReset();
  });

  it("keeps customer authorship immutable while staging AI analysis for merchant review", async () => {
    api.assistCatalogProductReview.mockResolvedValue(nextReview({
      moderation: {
        version: 2,
        ai_categories: ["product_quality"],
        ai_theme_summary: "Positive feedback about material quality.",
        ai_suggested_action: "approve",
        response_draft: "Thank you for sharing your experience.",
      },
      actions: [{
        id: "action_assist",
        action: "assist",
        expected_version: 1,
        resulting_version: 2,
        actor_provider_user_id: "user_admin",
        reason: null,
        created_at: "2026-06-19T12:05:00Z",
      }],
    }));

    renderWithProviders(<ProductReviewPanel productId="cat_coat" />);

    expect(await screen.findByText(baseReview.body)).toBeInTheDocument();
    expect(screen.getByLabelText("5 out of 5 stars")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(baseReview.body)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("5")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Analyze review" }));
    await waitFor(() => expect(api.assistCatalogProductReview).toHaveBeenCalledWith(
      "cat_coat",
      "review_one",
      { expected_version: 1 },
      "review-assist-key",
    ));
    expect(await screen.findByText("Positive feedback about material quality.")).toBeInTheDocument();
    expect(screen.getByLabelText("Merchant response for Maya R.")).toHaveValue("Thank you for sharing your experience.");
    expect(screen.getByText(/No moderation decision was published/i)).toBeInTheDocument();
  });

  it("requires a reason, records approval, and publishes only an explicit merchant response", async () => {
    api.decideCatalogProductReview
      .mockResolvedValueOnce(nextReview({ moderation: { version: 2, state: "approved" } }))
      .mockResolvedValueOnce(nextReview({
        moderation: {
          version: 3,
          state: "approved",
          response_draft: "We appreciate your thoughtful review.",
          response_published: "We appreciate your thoughtful review.",
          response_published_at: "2026-06-19T12:10:00Z",
        },
      }));

    renderWithProviders(<ProductReviewPanel productId="cat_coat" />);
    await screen.findByText(baseReview.body);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Merchant response for Maya R."), "We appreciate your thoughtful review.");
    await userEvent.type(screen.getByLabelText("Decision reason for Maya R."), "Verified customer feedback.");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.decideCatalogProductReview).toHaveBeenNthCalledWith(
      1,
      "cat_coat",
      "review_one",
      { action: "approve", expected_version: 1, reason: "Verified customer feedback." },
      "review-approve-key",
    ));
    expect(screen.getByLabelText("Merchant response for Maya R.")).toHaveValue("We appreciate your thoughtful review.");

    await userEvent.type(screen.getByLabelText("Decision reason for Maya R."), "Approved response copy.");
    await userEvent.click(screen.getByRole("button", { name: "Publish response" }));
    await waitFor(() => expect(api.decideCatalogProductReview).toHaveBeenNthCalledWith(
      2,
      "cat_coat",
      "review_one",
      {
        action: "publish_response",
        expected_version: 2,
        reason: "Approved response copy.",
        response_text: "We appreciate your thoughtful review.",
      },
      "review-publish_response-key",
    ));
  });

  it("retries provider failures with the same mutation key and preserves product edits", async () => {
    api.assistCatalogProductReview
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce(nextReview({
        moderation: { version: 2, ai_theme_summary: "Material-quality praise." },
      }));

    renderWithProviders(<ProductReviewPanel productId="cat_coat" manualEditsPending />);
    await screen.findByText(baseReview.body);
    await userEvent.click(screen.getByRole("button", { name: "Analyze review" }));

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Unsaved product edits remain separate/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry action" }));

    expect(await screen.findByText("Material-quality praise.")).toBeInTheDocument();
    expect(api.assistCatalogProductReview).toHaveBeenCalledTimes(2);
    expect(api.assistCatalogProductReview.mock.calls[0][3]).toBe(api.assistCatalogProductReview.mock.calls[1][3]);
    expect(api.createIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("surfaces stale decisions and reloads the current server state", async () => {
    api.decideCatalogProductReview.mockRejectedValueOnce({ response: { status: 409 } });
    renderWithProviders(<ProductReviewPanel productId="cat_coat" />);
    await screen.findByText(baseReview.body);
    await userEvent.type(screen.getByLabelText("Decision reason for Maya R."), "Needs policy review.");
    await userEvent.click(screen.getByRole("button", { name: "Flag" }));

    expect(await screen.findByText(/changed on the server/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh reviews" }));
    await waitFor(() => expect(api.getAdminCatalogProductReviews).toHaveBeenCalledTimes(2));
  });

  it("does not loop retries when the administrator session expires", async () => {
    api.decideCatalogProductReview.mockRejectedValueOnce({ response: { status: 403 } });
    renderWithProviders(<ProductReviewPanel productId="cat_coat" />);
    await screen.findByText(baseReview.body);
    await userEvent.type(screen.getByLabelText("Decision reason for Maya R."), "Verified customer feedback.");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByText(/administrator session expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry action" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh reviews" })).toBeInTheDocument();
  });

  it("clears the prior product and ignores an in-flight action after product navigation", async () => {
    let finishAssist;
    const otherReview = nextReview({
      id: "review_two",
      product_id: "cat_dress",
      author_display_name: "Jordan T.",
      body: "The fit was smaller than expected.",
      rating: 3,
    });
    api.getAdminCatalogProductReviews
      .mockReset()
      .mockResolvedValueOnce({ items: [baseReview] })
      .mockResolvedValueOnce({ items: [otherReview] });
    api.assistCatalogProductReview.mockReturnValue(new Promise((resolve) => { finishAssist = resolve; }));

    function ProductSwitchHarness() {
      const [productId, setProductId] = useState("cat_coat");
      return <><button type="button" onClick={() => setProductId("cat_dress")}>Switch product</button><ProductReviewPanel productId={productId} /></>;
    }

    renderWithProviders(<ProductSwitchHarness />);
    await screen.findByText(baseReview.body);
    await userEvent.click(screen.getByRole("button", { name: "Analyze review" }));
    await userEvent.click(screen.getByRole("button", { name: "Switch product" }));

    expect(screen.queryByText(baseReview.body)).not.toBeInTheDocument();
    expect(await screen.findByText(otherReview.body)).toBeInTheDocument();
    finishAssist(nextReview({ moderation: { version: 2, ai_theme_summary: "Stale coat analysis." } }));
    await waitFor(() => expect(screen.queryByText("Stale coat analysis.")).not.toBeInTheDocument());
    expect(screen.queryByText(/No moderation decision was published/i)).not.toBeInTheDocument();
  });
});
