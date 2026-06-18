import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminRoute, { CatalogStudioAccessProvider } from "../components/AdminRoute";
import DeveloperLensProvider from "../components/DeveloperLensProvider";
import { renderWithProviders } from "../test/render";
import CatalogStudioPage from "./CatalogStudioPage";

const clerk = vi.hoisted(() => ({
  state: { isLoaded: true, isSignedIn: true, getToken: vi.fn() },
}));
const api = vi.hoisted(() => ({
  approveCatalogImageJob: vi.fn(),
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  getAdminCatalogProduct: vi.fn(),
  getAdminCatalogProducts: vi.fn(),
  getCatalogImageJob: vi.fn(),
  getCatalogStudioSession: vi.fn(),
  getCatalogWorkflow: vi.fn(),
  startCatalogWorkflow: vi.fn(),
  submitCatalogDraftCommand: vi.fn(),
  submitCatalogImageCommand: vi.fn(),
}));
const telemetry = vi.hoisted(() => ({ trackCatalogStudioMilestone: vi.fn() }));

vi.mock("@clerk/clerk-react", () => ({ useAuth: () => clerk.state }));
vi.mock("../utils/apiClient", () => api);
vi.mock("../utils/clerkConfig", () => ({ CLERK_ENABLED: true }));
vi.mock("../utils/datadog", () => telemetry);
vi.mock("../components/admin/ProductEditor", () => ({
  default: ({ productId, onLifecycleChanged }) => (
    <div data-testid="contract-product-editor">
      Product editor for {productId}
      <button type="button" onClick={() => onLifecycleChanged?.("published", { product_id: productId, current_draft: null })}>
        Publish contract product
      </button>
    </div>
  ),
}));
vi.mock("../components/admin/VoiceControls", () => ({
  default: ({ onToolResult, realtimeCapability, workflowId }) => (
    <div>
      <span>Realtime capability: {realtimeCapability?.reason || (realtimeCapability?.configured ? "ready" : "unknown")}</span>
      <button type="button" onClick={() => onToolResult?.({ status: "failed", message: "Voice is unavailable; continue with text." }, workflowId)}>
        Simulate voice failure
      </button>
    </div>
  ),
}));

const event = (id, sequence, capability, status, businessSummary, developer) => ({
  id,
  sequence,
  capability,
  stage: capability,
  status,
  business_summary: businessSummary,
  retryable: false,
  created_at: "2026-06-17T12:00:00Z",
  ...(developer ? { developer } : {}),
});

const draft = {
  id: "draft_contract",
  product_id: "cat_contract_coat",
  draft_version: 1,
  moderation_state: "approved",
  product: { title: "Contract Coat" },
};

const workflow = {
  id: "workflow_contract",
  status: "running",
  current_stage: "catalog",
  events: [
    event("event_responses", 1, "responses", "succeeded", "Responses structured the product.", {
      model: "gpt-5",
      request_id: "req_contract",
      request_payload: { instruction_summary: "Create a coat", authorization: "Bearer never-render" },
      response_payload: { title: "Contract Coat", chain_of_thought: "never-render" },
    }),
    event("event_moderation", 2, "moderation", "succeeded", "Moderation approved the product."),
    event("event_catalog", 3, "catalog", "succeeded", "Saved one private draft."),
  ],
};

const session = {
  authorized: true,
  capabilities: Object.fromEntries(
    ["responses", "moderation", "image_generation", "realtime", "worker_storage", "catalog"].map((name) => [name, { configured: true }]),
  ),
};

function renderStudio() {
  return renderWithProviders(
    <CatalogStudioAccessProvider>
      <DeveloperLensProvider>
        <AdminRoute><CatalogStudioPage /></AdminRoute>
      </DeveloperLensProvider>
    </CatalogStudioAccessProvider>,
    { route: "/catalog-studio" },
  );
}

describe("Catalog Studio contract journey", () => {
  beforeEach(() => {
    clerk.state = { isLoaded: true, isSignedIn: true, getToken: vi.fn().mockResolvedValue("clerk-token") };
    api.getCatalogStudioSession.mockReset().mockResolvedValue(session);
    api.startCatalogWorkflow.mockReset().mockResolvedValue({ ...workflow, events: [] });
    api.submitCatalogDraftCommand.mockReset().mockResolvedValue({
      status: "succeeded", message: "Draft created.", retryable: false, replayed: false, draft, workflow,
    });
    api.getCatalogWorkflow.mockReset().mockResolvedValue(workflow);
    api.submitCatalogImageCommand.mockReset();
    api.getCatalogImageJob.mockReset();
    api.approveCatalogImageJob.mockReset();
    api.getAdminCatalogProduct.mockReset();
    api.getAdminCatalogProducts.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 12 });
    telemetry.trackCatalogStudioMilestone.mockReset();
  });

  it("covers authorization, draft creation, developer inspection, and publication handoff", async () => {
    sessionStorage.setItem("sterling-hollis:catalog-studio:developer-lens", "enabled");
    const user = userEvent.setup();
    renderStudio();

    await screen.findByRole("heading", { name: "Build and manage the product catalog" });
    expect(screen.getByText("Realtime capability: ready")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Catalog product instruction"), "Create a contract coat");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("Draft created.")).toBeInTheDocument();
    expect(screen.getByTestId("contract-product-editor")).toHaveTextContent("cat_contract_coat");
    expect(screen.getByText("Sanitized API metadata")).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("never-render");

    api.getCatalogWorkflow.mockResolvedValue({
      ...workflow,
      status: "completed",
      current_stage: "publication",
      published_product_id: "cat_contract_coat",
      events: [...workflow.events, event("event_publication", 4, "publication", "completed", "Published the product.")],
    });
    await user.click(screen.getByRole("button", { name: "Publish contract product" }));

    expect(await screen.findByRole("link", { name: "View published product" })).toHaveAttribute("href", "/product/cat_contract_coat");
    expect(api.getCatalogStudioSession).toHaveBeenCalledWith("clerk-token");
    expect(telemetry.trackCatalogStudioMilestone).toHaveBeenCalledWith("draft_command_finished", expect.objectContaining({
      product_id: "cat_contract_coat", status: "succeeded", workflow_id: "workflow_contract",
    }));
    expect(telemetry.trackCatalogStudioMilestone).toHaveBeenCalledWith("product_published", expect.objectContaining({
      product_id: "cat_contract_coat", workflow_id: "workflow_contract",
    }));
  });

  it("stops a moderated request before product or image creation", async () => {
    const blockedWorkflow = {
      ...workflow,
      events: [
        event("event_responses", 1, "responses", "succeeded", "Responses completed."),
        event("event_moderation", 2, "moderation", "blocked", "Request stopped by policy."),
      ],
    };
    api.submitCatalogDraftCommand.mockResolvedValue({
      status: "blocked", message: "The request was blocked by policy.", retryable: false, replayed: false, draft: null, workflow: blockedWorkflow,
    });
    api.getCatalogWorkflow.mockResolvedValue(blockedWorkflow);
    renderStudio();

    await userEvent.type(await screen.findByLabelText("Catalog product instruction"), "Create prohibited merchandise");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("The request was blocked by policy.")).toBeInTheDocument();
    expect(screen.queryByTestId("contract-product-editor")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate primary image/i })).not.toBeInTheDocument();
    expect(api.submitCatalogImageCommand).not.toHaveBeenCalled();
  });

  it("preserves the draft when text, image, or voice capabilities fail", async () => {
    const user = userEvent.setup();
    renderStudio();
    const instruction = await screen.findByLabelText("Catalog product instruction");
    await user.type(instruction, "Create a resilient coat");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    await screen.findByTestId("contract-product-editor");

    api.submitCatalogDraftCommand.mockRejectedValueOnce({ response: { status: 503 } });
    await user.type(instruction, "Make it navy");
    await user.click(screen.getByRole("button", { name: "Refine draft" }));
    expect(await screen.findByRole("button", { name: /Retry instruction/i })).toBeInTheDocument();
    expect(screen.getByTestId("contract-product-editor")).toBeInTheDocument();

    api.submitCatalogImageCommand.mockRejectedValueOnce({ response: { status: 503 } });
    await user.click(screen.getByRole("button", { name: /Generate primary image/i }));
    expect(await screen.findByRole("button", { name: /Retry image action/i })).toBeInTheDocument();
    expect(screen.getByTestId("contract-product-editor")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Simulate voice failure" }));
    expect(await screen.findByText("Voice is unavailable; continue with text.")).toBeInTheDocument();
    expect(screen.getByTestId("contract-product-editor")).toBeInTheDocument();
  });

  it("keeps signed-out visitors outside the Studio without invoking protected contracts", async () => {
    clerk.state = { isLoaded: true, isSignedIn: false, getToken: vi.fn() };
    renderStudio();

    expect(screen.getByText("Sign in to Catalog Studio")).toBeInTheDocument();
    expect(api.getCatalogStudioSession).not.toHaveBeenCalled();
    expect(api.startCatalogWorkflow).not.toHaveBeenCalled();
  });
});
