import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DeveloperLensProvider from "../DeveloperLensProvider";
import { renderWithProviders } from "../../test/render";
import ProductCreationWorkspace from "./ProductCreationWorkspace";

const api = vi.hoisted(() => ({
  approveCatalogImageJob: vi.fn(),
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  getAdminCatalogProduct: vi.fn(),
  getCatalogImageJob: vi.fn(),
  getCatalogWorkflow: vi.fn(),
  startCatalogWorkflow: vi.fn(),
  submitCatalogDraftCommand: vi.fn(),
  submitCatalogImageCommand: vi.fn(),
}));
vi.mock("../../utils/apiClient", () => api);
vi.mock("./ProductEditor", () => ({
  default: ({ productId, onCatalogChanged, onLifecycleChanged }) => (
    <div data-testid="product-editor">
      Editor for {productId}
      <button type="button" onClick={() => onCatalogChanged?.({ product_id: productId, current_draft: { revision: { id: "draft_1" }, draft_version: 2 } })}>Simulate editor save</button>
      <button type="button" onClick={() => onLifecycleChanged?.("published", { product_id: productId, current_draft: null })}>Simulate publication</button>
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

function renderWorkspace() {
  return renderWithProviders(<DeveloperLensProvider><ProductCreationWorkspace /></DeveloperLensProvider>, { route: "/catalog-studio" });
}

describe("ProductCreationWorkspace", () => {
  beforeEach(() => {
    api.startCatalogWorkflow.mockReset().mockResolvedValue({ ...baseWorkflow, events: [] });
    api.getCatalogWorkflow.mockReset().mockResolvedValue(baseWorkflow);
    api.submitCatalogDraftCommand.mockReset().mockResolvedValue({ status: "succeeded", message: "Draft created.", retryable: false, replayed: false, draft, workflow: baseWorkflow });
    api.submitCatalogImageCommand.mockReset();
    api.getCatalogImageJob.mockReset();
    api.approveCatalogImageJob.mockReset().mockResolvedValue({ job_id: "job_1", draft_id: "draft_1", variant_index: 0, approval_status: "approved" });
    api.getAdminCatalogProduct.mockReset().mockResolvedValue({ current_draft: { revision: { id: "draft_1" }, draft_version: 2 } });
  });

  it("creates one draft with separate Responses and Moderation stages, then refines the same draft", async () => {
    renderWorkspace();
    const instruction = screen.getByLabelText("Catalog product instruction");
    await userEvent.type(instruction, "Create a tailored wool coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("Draft created.")).toBeInTheDocument();
    expect(screen.getByTestId("product-editor")).toHaveTextContent("cat_coat");
    expect(screen.getByText("Responses structured the product.")).toBeInTheDocument();
    expect(screen.getByText("Moderation approved the product.")).toBeInTheDocument();
    expect(api.startCatalogWorkflow).toHaveBeenCalledWith({
      title: "Catalog Studio product creation",
      business_summary: "Text-guided catalog product creation workflow.",
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
    await userEvent.type(instruction, "Make it navy");
    await userEvent.click(screen.getByRole("button", { name: "Refine draft" }));
    await waitFor(() => expect(api.submitCatalogDraftCommand).toHaveBeenLastCalledWith("workflow_1", {
      instruction: "Make it navy",
      current_draft_id: "draft_1",
      expected_draft_version: 1,
    }, "draft-command-key"));
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
    expect(screen.getByText("Request stopped by policy.")).toBeInTheDocument();
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
    await userEvent.type(input, "Make it blue");
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
    expect(screen.getByText("Published the product.")).toBeInTheDocument();
    expect(screen.queryByTestId("product-editor")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Catalog product instruction")).toBeDisabled();
  });
});
