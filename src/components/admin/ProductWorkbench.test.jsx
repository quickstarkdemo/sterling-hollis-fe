import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DeveloperLensProvider from "../DeveloperLensProvider";
import { renderWithProviders } from "../../test/render";
import ProductWorkbench from "./ProductWorkbench";

const api = vi.hoisted(() => ({
  approveCatalogImageJob: vi.fn(),
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  getAdminCatalogProduct: vi.fn(),
  generateCatalogSuggestionSet: vi.fn(),
  getCatalogImageJob: vi.fn(),
  getCatalogWorkflow: vi.fn(),
  startCatalogWorkflow: vi.fn(),
  submitCatalogDraftCommand: vi.fn(),
  submitCatalogImageCommand: vi.fn(),
}));
vi.mock("../../utils/apiClient", () => api);
vi.mock("./ProductEditor", () => ({
  default: ({ productId, authoringSchemaVersion, references, onCatalogChanged, onLifecycleChanged, onDetailChange }) => (
    <div data-testid="product-editor">
      Editor for {productId}; schema {authoringSchemaVersion}; stores {references?.stores?.length || 0}
      <button type="button" onClick={() => onCatalogChanged?.({ product_id: productId, current_draft: { revision: { id: "draft_1" }, draft_version: 2 } })}>Simulate editor save</button>
      <button type="button" onClick={() => onLifecycleChanged?.("published", { product_id: productId, current_draft: null })}>Simulate publication</button>
      <button type="button" onClick={() => onDetailChange?.({ product_id: productId, title: "Studio Coat", current_draft: { revision: { id: "draft_1" }, draft_version: 2 } })}>Load authoring draft</button>
    </div>
  ),
}));
vi.mock("./ProductSourceTray", () => ({
  default: ({ productId, draft, onSuggestionsChanged }) => <div data-testid="source-tray">Sources for {productId} v{draft.draft_version}<button type="button" onClick={() => onSuggestionsChanged?.({ id: "set_one" })}>Simulate supplier analysis</button></div>,
}));
vi.mock("./SuggestionReviewPanel", () => ({
  default: ({ productId, refreshSignal }) => <div data-testid="suggestion-review">Suggestions for {productId}; refresh {refreshSignal}</div>,
}));
vi.mock("./ProductReviewPanel", () => ({
  default: ({ productId, manualEditsPending }) => <div data-testid="product-review-panel">Reviews for {productId}; edits {manualEditsPending ? "pending" : "saved"}</div>,
}));
vi.mock("./VoiceControls", () => ({
  default: ({ ensureWorkflow, onToolResult, sessionContext, contextLabel }) => (
    <div data-testid="voice-controls">
      <button type="button" onClick={() => { void ensureWorkflow?.(); }}>Start voice workflow</button>
      <button type="button" onClick={() => onToolResult?.({
        status: "succeeded",
        message: "Draft updated by voice.",
        draft: { id: "draft_1", product_id: "cat_coat", draft_version: 2 },
        workflow: baseWorkflow,
      }, "workflow_1")}>Simulate voice result</button>
      <span>Voice mode {sessionContext?.mode || "none"}; target {sessionContext?.target_path || "none"}; label {contextLabel || "none"}</span>
    </div>
  ),
}));

const event = (id, sequence, capability, status, summary, extra = {}) => ({
  id, sequence, capability, stage: capability, status, business_summary: summary, retryable: false, created_at: "2026-06-17T12:00:00Z", ...extra,
});

const baseWorkflow = {
  id: "workflow_1",
  title: "Create a coat",
  business_summary: "Create a coat",
  status: "running",
  current_stage: "catalog",
  is_owner: true,
  created_at: "2026-06-17T12:00:00Z",
  updated_at: "2026-06-17T12:00:00Z",
  expires_at: "2026-06-18T12:00:00Z",
  events: [
    event("event_1", 1, "responses", "succeeded", "Responses structured the product."),
    event("event_2", 2, "moderation", "succeeded", "Moderation approved the product."),
    event("event_3", 3, "catalog", "succeeded", "Saved one private draft."),
  ],
};

const draft = {
  id: "draft_1",
  product_id: "cat_coat",
  draft_version: 1,
  base_version: 0,
  moderation_state: "approved",
  image_direction: "Editorial studio image",
  product: { title: "Studio Coat" },
};

function renderWorkspace(props = {}) {
  return renderWithProviders(<DeveloperLensProvider><ProductWorkbench {...props} /></DeveloperLensProvider>, { route: "/catalog-studio" });
}

async function openLegacyImageGeneration(user = userEvent) {
  await user.click(screen.getByRole("tab", { name: "Legacy images" }));
}

describe("ProductWorkbench", () => {
  beforeEach(() => {
    api.startCatalogWorkflow.mockReset().mockResolvedValue({ ...baseWorkflow, events: [] });
    api.getCatalogWorkflow.mockReset().mockResolvedValue(baseWorkflow);
    api.submitCatalogDraftCommand.mockReset().mockResolvedValue({ status: "succeeded", message: "Draft created.", retryable: false, replayed: false, draft, workflow: baseWorkflow });
    api.submitCatalogImageCommand.mockReset();
    api.getCatalogImageJob.mockReset();
    api.approveCatalogImageJob.mockReset().mockResolvedValue({ job_id: "job_1", draft_id: "draft_1", variant_index: 0, approval_status: "approved" });
    api.getAdminCatalogProduct.mockReset().mockResolvedValue({ current_draft: { revision: { id: "draft_1" }, draft_version: 2 } });
    api.generateCatalogSuggestionSet.mockReset().mockResolvedValue({ status: "succeeded", message: "Proposal ready.", suggestion_set: { id: "set_voice" } });
  });

  it("creates one draft with separate Responses and Moderation stages, then refines the same draft", async () => {
    renderWorkspace();
    const instruction = screen.getByLabelText("Catalog product instruction");
    await userEvent.type(instruction, "Create a tailored wool coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("Draft created.")).toBeInTheDocument();
    expect(screen.getByTestId("product-editor")).toHaveTextContent("cat_coat");
    expect(screen.queryByText("Responses structured the product.")).not.toBeInTheDocument();
    expect(screen.queryByText("Moderation approved the product.")).not.toBeInTheDocument();
    expect(api.startCatalogWorkflow).toHaveBeenCalledWith({
      title: "Product Catalog product creation",
      business_summary: "Text-guided product creation workflow.",
    }, "start-workflow-key");
    expect(JSON.stringify(api.startCatalogWorkflow.mock.calls[0])).not.toContain("tailored wool coat");
    expect(api.submitCatalogDraftCommand).toHaveBeenCalledWith("workflow_1", {
      instruction: "Create a tailored wool coat",
      current_draft_id: null,
      expected_draft_version: 0,
    }, "draft-command-key");

    api.submitCatalogDraftCommand.mockResolvedValueOnce({
      status: "succeeded", message: "Draft refined.", retryable: false, replayed: false,
      draft: { ...draft, draft_version: 2 }, workflow: baseWorkflow,
    });
    await userEvent.click(screen.getByRole("tab", { name: "Product chat" }));
    await userEvent.type(screen.getByLabelText("Catalog product instruction"), "Make it navy");
    await userEvent.click(screen.getByRole("button", { name: "Refine draft" }));
    await waitFor(() => expect(api.submitCatalogDraftCommand).toHaveBeenLastCalledWith("workflow_1", {
      instruction: "Make it navy",
      current_draft_id: "draft_1",
      expected_draft_version: 1,
    }, "draft-command-key"));
  });

  it("reveals supplier sources and one suggestion lifecycle for the active draft", async () => {
    renderWorkspace({ authoringSchemaVersion: 3 });
    await userEvent.type(screen.getByLabelText("Catalog product instruction"), "Create a supplier-backed coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await userEvent.click(await screen.findByRole("button", { name: "Load authoring draft" }));

    await userEvent.click(screen.getByRole("tab", { name: "Supplier import" }));
    expect(screen.getByTestId("source-tray")).toHaveTextContent("cat_coat v2");
    expect(screen.getByRole("tab", { name: "Reviews" })).toHaveAttribute("aria-selected", "false");
    await userEvent.click(screen.getByRole("button", { name: "Simulate supplier analysis" }));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    expect(screen.getByTestId("suggestion-review")).toHaveTextContent("refresh 1");
  });

  it("uses voice as an alternate input to the same workflow and draft state", async () => {
    renderWorkspace({
      authoringSchemaVersion: 2,
      references: { stores: [{ id: "1001", name: "Dallas" }], brands: [], categories: [], availability: [] },
      referencesStatus: "ready",
    });

    await userEvent.click(screen.getByRole("button", { name: "Start voice workflow" }));
    await waitFor(() => expect(api.startCatalogWorkflow).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("voice-controls")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Simulate voice result" }));
    expect(await screen.findByText("Draft updated by voice.")).toBeInTheDocument();
    expect(screen.getByText("Draft version 2")).toBeInTheDocument();
    expect(screen.getByTestId("product-editor")).toHaveTextContent("cat_coat; schema 2; stores 1");
  });

  it("uses one product chat for product-wide voice context", async () => {
    renderWorkspace({ authoringSchemaVersion: 3, activeProductId: "cat_coat" });
    await userEvent.click(await screen.findByRole("button", { name: "Load authoring draft" }));
    await userEvent.click(screen.getByRole("tab", { name: "Product chat" }));

    expect(screen.getByTestId("voice-controls")).toHaveTextContent("Voice mode workbench; target none; label Studio Coat");
    await userEvent.click(screen.getByRole("button", { name: "Start voice workflow" }));

    await waitFor(() => expect(api.startCatalogWorkflow).toHaveBeenCalledWith({
      title: "Product Catalog workbench for Studio Coat",
      business_summary: "Contextual product, inventory, catalog, and readiness assistance.",
      draft_id: "draft_1",
    }, "start-workflow-key"));
    expect(api.generateCatalogSuggestionSet).not.toHaveBeenCalled();
  });

  it("hands a v2 guided draft to the canonical editor with shared references", async () => {
    const references = { stores: [{ id: "1001", name: "Dallas" }], brands: [], categories: [], availability: [] };
    renderWorkspace({ authoringSchemaVersion: 2, references, referencesStatus: "ready" });

    await userEvent.type(screen.getByLabelText("Catalog product instruction"), "Create a coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByTestId("product-editor")).toHaveTextContent("schema 2; stores 1");
    expect(screen.queryByText("Version-bound imagery")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate primary image/i })).not.toBeInTheDocument();
  });

  it("explains a moderation block and keeps image controls unavailable", async () => {
    const blockedWorkflow = {
      ...baseWorkflow,
      events: [event("event_1", 1, "responses", "succeeded", "Responses completed."), event("event_2", 2, "moderation", "blocked", "Request stopped by policy.")],
    };
    api.submitCatalogDraftCommand.mockResolvedValueOnce({ status: "blocked", message: "The request was blocked by policy.", retryable: false, replayed: false, draft: null, workflow: blockedWorkflow });
    api.getCatalogWorkflow.mockResolvedValue(blockedWorkflow);
    renderWorkspace();

    await userEvent.type(screen.getByLabelText("Catalog product instruction"), "Unsafe request");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("The request was blocked by policy.")).toBeInTheDocument();
    expect(screen.queryByText("Request stopped by policy.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate primary image/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("product-editor")).not.toBeInTheDocument();
  });

  it("polls a queued image through running and succeeded states", async () => {
    const user = userEvent.setup();
    api.submitCatalogImageCommand.mockResolvedValue({ id: "job_1", workflow_id: "workflow_1", draft_id: "draft_1", expected_draft_version: 1, action: "generate", variant_index: 0, model: "gpt-image", size: "1024x1024", quality: "medium", output_format: "png", status: "queued", created_at: "2026-06-17T12:00:00Z" });
    api.getCatalogImageJob
      .mockResolvedValueOnce({ id: "job_1", status: "running" })
      .mockResolvedValueOnce({ id: "job_1", status: "succeeded" });
    renderWorkspace();
    await user.type(screen.getByLabelText("Catalog product instruction"), "Create a coat");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    await screen.findByTestId("product-editor");
    await openLegacyImageGeneration(user);
    await user.click(screen.getByRole("button", { name: /Generate primary image/i }));
    expect(await screen.findByText("queued")).toBeInTheDocument();

    expect(await screen.findByText("running")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Approve image/i }, { timeout: 4000 })).toBeInTheDocument();
  }, 10000);

  it("preserves the current draft and offers retry only for retryable failures", async () => {
    renderWorkspace();
    const input = screen.getByLabelText("Catalog product instruction");
    await userEvent.type(input, "Create a coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await screen.findByTestId("product-editor");

    api.submitCatalogDraftCommand.mockRejectedValueOnce({ response: { status: 503 } });
    await userEvent.click(screen.getByRole("tab", { name: "Product chat" }));
    await userEvent.type(screen.getByLabelText("Catalog product instruction"), "Make it blue");
    await userEvent.click(screen.getByRole("button", { name: "Refine draft" }));

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.getByTestId("product-editor")).toHaveTextContent("cat_coat");
    expect(screen.getByRole("button", { name: /Retry instruction/i })).toBeInTheDocument();
  });

  it("uses the latest draft version after manual Product Editor changes", async () => {
    api.submitCatalogImageCommand.mockResolvedValue({ id: "job_1", status: "succeeded", action: "generate" });
    renderWorkspace();
    await userEvent.type(screen.getByLabelText("Catalog product instruction"), "Create a coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await screen.findByTestId("product-editor");

    await userEvent.click(screen.getByRole("button", { name: "Simulate editor save" }));
    expect(screen.getByText("Draft version 2")).toBeInTheDocument();
    await openLegacyImageGeneration();
    await userEvent.click(screen.getByRole("button", { name: /Generate primary image/i }));

    expect(api.submitCatalogImageCommand).toHaveBeenCalledWith("workflow_1", expect.objectContaining({
      draft_id: "draft_1",
      expected_draft_version: 2,
    }), "image-generate-key");
  });

  it("retries image approval without creating another image job", async () => {
    api.submitCatalogImageCommand.mockResolvedValue({ id: "job_1", status: "succeeded", action: "generate" });
    api.approveCatalogImageJob
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ job_id: "job_1", approval_status: "approved" });
    renderWorkspace();
    await userEvent.type(screen.getByLabelText("Catalog product instruction"), "Create a coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await screen.findByTestId("product-editor");
    await openLegacyImageGeneration();
    await userEvent.click(screen.getByRole("button", { name: /Generate primary image/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Approve image/i }));

    expect(await screen.findByRole("button", { name: /Retry image approval/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Retry image approval/i }));

    await waitFor(() => expect(api.approveCatalogImageJob).toHaveBeenCalledTimes(2));
    expect(api.submitCatalogImageCommand).toHaveBeenCalledTimes(1);
  });

  it("links to the published product while preserving a read-only workflow summary", async () => {
    renderWorkspace();
    await userEvent.type(screen.getByLabelText("Catalog product instruction"), "Create a coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await screen.findByTestId("product-editor");

    api.getCatalogWorkflow.mockResolvedValue({
      ...baseWorkflow,
      status: "completed",
      current_stage: "publication",
      published_product_id: "cat_coat",
      events: [...baseWorkflow.events, event("event_4", 4, "publication", "completed", "Published the product.")],
    });
    await userEvent.click(screen.getByRole("button", { name: "Simulate publication" }));

    expect(await screen.findByText("This workflow is complete and read-only.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View published product" })).toHaveAttribute("href", "/product/cat_coat");
    expect(screen.queryByText("Published the product.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("product-editor")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Catalog product instruction")).toBeDisabled();
  });
});
