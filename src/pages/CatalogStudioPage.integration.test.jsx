import { screen, waitFor } from "@testing-library/react";
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
  assistCatalogProductReview: vi.fn(),
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  decideCatalogProductReview: vi.fn(),
  generateCatalogSuggestionSet: vi.fn(),
  getAdminCatalogProduct: vi.fn(),
  getAdminCatalogProductReviews: vi.fn(),
  getAdminCatalogProductsCompatibility: vi.fn(),
  getAdminCatalogReferences: vi.fn(),
  getCatalogImageJob: vi.fn(),
  getCatalogStudioSession: vi.fn(),
  getCatalogWorkflow: vi.fn(),
  queryCatalogAssistant: vi.fn(),
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
  default: ({ productId, authoringSchemaVersion, references, onLifecycleChanged, onDetailChange, refreshKey }) => (
    <div data-testid="contract-product-editor">
      Product editor for {productId}; schema {authoringSchemaVersion}; stores {references?.stores?.length || 0}; refresh {refreshKey}
      <span>Manual details, media, inventory, and readiness remain available</span>
      <button type="button" onClick={() => onLifecycleChanged?.("published", { product_id: productId, current_draft: null })}>
        Publish contract product
      </button>
      <button type="button" onClick={() => onDetailChange?.({ product_id: productId, title: "Contract Coat", current_draft: { revision: { id: "draft_contract" }, draft_version: 1 } })}>Load supplier authoring</button>
    </div>
  ),
}));
vi.mock("../components/admin/ProductSourceTray", () => ({
  default: ({ productId, onSuggestionsChanged }) => <div data-testid="contract-source-tray">Supplier sources for {productId}<button type="button" onClick={() => onSuggestionsChanged?.({ id: "supplier_set" })}>Analyze supplier handoff</button></div>,
}));
vi.mock("../components/admin/SuggestionReviewPanel", () => ({
  default: ({ productId, refreshSignal, onDraftChanged }) => <div data-testid="contract-suggestion-review">Suggestion review for {productId}; refresh {refreshSignal}<button type="button" onClick={() => onDraftChanged?.({ draft: { draft_version: 2 } })}>Accept supplier description</button></div>,
}));
vi.mock("../components/admin/VoiceControls", () => ({
  default: ({ assistantMode = "edit", onToolResult, realtimeCapability, sessionContext, workflowId }) => (
    <div>
      <span>{assistantMode === "read" ? "Assistant realtime capability" : "Realtime capability"}: {realtimeCapability?.reason || (realtimeCapability?.configured ? "ready" : "unknown")}</span>
      <span>{assistantMode === "read" ? "Assistant voice context" : "Voice context"}: {sessionContext?.mode || "none"}</span>
      <button type="button" onClick={() => onToolResult?.({ status: "succeeded", message: "Dallas has two units; no product state changed." }, workflowId)}>
        {assistantMode === "read" ? "Ask assistant inventory question" : "Ask grounded inventory question"}
      </button>
      <button type="button" onClick={() => onToolResult?.({ status: "succeeded", message: "Product voice proposal is ready.", suggestion_set: { id: "voice_set" } }, workflowId)}>
        {assistantMode === "read" ? "Complete assistant voice answer" : "Complete product voice proposal"}
      </button>
      <button type="button" onClick={() => onToolResult?.({ status: "failed", message: "Voice is unavailable; continue with text." }, workflowId)}>
        {assistantMode === "read" ? "Simulate assistant voice failure" : "Simulate voice failure"}
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

const customerReview = {
  id: "review_contract",
  product_id: "cat_contract_coat",
  source: "synthetic_fixture",
  external_review_id: "review-one",
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
    api.getAdminCatalogProductReviews.mockReset().mockResolvedValue({ items: [customerReview] });
    api.assistCatalogProductReview.mockReset();
    api.decideCatalogProductReview.mockReset().mockResolvedValue({
      ...customerReview,
      moderation: { ...customerReview.moderation, version: 2, state: "approved" },
    });
    api.generateCatalogSuggestionSet.mockReset();
    api.getAdminCatalogProductsCompatibility.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 12 });
    api.getAdminCatalogReferences.mockReset().mockResolvedValue({ stores: [{ id: "1001", name: "Dallas" }], brands: [], categories: [], availability: [] });
    session.capabilities.catalog.authoring_schema_version = 1;
    telemetry.trackCatalogStudioMilestone.mockReset();
  });

  it("covers authorization, draft creation, hidden developer metadata, and publication handoff", async () => {
    sessionStorage.setItem("sterling-hollis:catalog-studio:developer-lens", "enabled");
    const user = userEvent.setup();
    renderStudio();

    await screen.findByRole("heading", { name: "Catalog Studio" });
    await user.click(screen.getByRole("button", { name: "New product" }));
    expect(screen.getByText("Realtime capability: ready")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Catalog product instruction"), "Create a contract coat");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("Draft created.")).toBeInTheDocument();
    expect(screen.getByTestId("contract-product-editor")).toHaveTextContent("cat_contract_coat");
    expect(screen.queryByText("Sanitized API metadata")).not.toBeInTheDocument();
    expect(screen.queryByText("gpt-5")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("sterling-hollis:catalog-studio:developer-lens")).toBe("enabled");
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

    await userEvent.click(await screen.findByRole("button", { name: "New product" }));
    await userEvent.type(await screen.findByLabelText("Catalog product instruction"), "Create prohibited merchandise");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("The request was blocked by policy.")).toBeInTheDocument();
    expect(screen.queryByTestId("contract-product-editor")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate primary image/i })).not.toBeInTheDocument();
    expect(api.submitCatalogImageCommand).not.toHaveBeenCalled();
  });

  it("uses the canonical merchandiser editor for guided v2 drafts", async () => {
    session.capabilities.catalog.authoring_schema_version = 2;
    renderStudio();

    await userEvent.click(await screen.findByRole("button", { name: "New product" }));
    await userEvent.type(await screen.findByLabelText("Catalog product instruction"), "Create a canonical coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByTestId("contract-product-editor")).toHaveTextContent("schema 2; stores 1");
    expect(api.getAdminCatalogReferences).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Version-bound imagery")).not.toBeInTheDocument();
  });

  it("continues from a supplier handoff into explicit suggestion acceptance", async () => {
    session.capabilities.catalog.authoring_schema_version = 3;
    renderStudio();

    await userEvent.click(await screen.findByRole("button", { name: "New product" }));
    await userEvent.type(await screen.findByLabelText("Catalog product instruction"), "Create a supplier-backed coat");
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await userEvent.click(await screen.findByRole("button", { name: "Load supplier authoring" }));

    await userEvent.click(screen.getByRole("tab", { name: "Supplier import" }));
    expect(screen.getByTestId("contract-source-tray")).toHaveTextContent("cat_contract_coat");
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    expect(screen.getByTestId("contract-suggestion-review")).toHaveTextContent("refresh 0");

    await userEvent.click(screen.getByRole("tab", { name: "Product chat" }));
    await userEvent.click(screen.getByRole("button", { name: "Ask grounded inventory question" }));
    expect(await screen.findByText("Dallas has two units; no product state changed.")).toBeInTheDocument();
    expect(screen.getByText("Voice context: workbench")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Complete product voice proposal" }));
    expect(await screen.findByText("Product voice proposal is ready.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    expect(screen.getByTestId("contract-suggestion-review")).toHaveTextContent("refresh 1");

    await userEvent.click(screen.getByRole("tab", { name: "Supplier import" }));
    await userEvent.click(screen.getByRole("button", { name: "Analyze supplier handoff" }));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    expect(screen.getByTestId("contract-suggestion-review")).toHaveTextContent("refresh 2");
    await userEvent.click(screen.getByRole("button", { name: "Accept supplier description" }));
    await userEvent.click(screen.getByRole("tab", { name: "Product details" }));
    expect(screen.getByTestId("contract-product-editor")).toHaveTextContent("refresh 2");

    await userEvent.click(screen.getByRole("tab", { name: "Reviews" }));
    expect(await screen.findByText(customerReview.body)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Decision reason for Maya R."), "Verified customer feedback.");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.decideCatalogProductReview).toHaveBeenCalledWith(
      "cat_contract_coat",
      "review_contract",
      { action: "approve", expected_version: 1, reason: "Verified customer feedback." },
      "review-approve-key",
    ));
    expect(screen.getByText("Manual details, media, inventory, and readiness remain available")).toBeInTheDocument();
  });

  it("preserves the draft when text, image, or voice capabilities fail", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(await screen.findByRole("button", { name: "New product" }));
    const instruction = await screen.findByLabelText("Catalog product instruction");
    await user.type(instruction, "Create a resilient coat");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    await screen.findByTestId("contract-product-editor");

    api.submitCatalogDraftCommand.mockRejectedValueOnce({ response: { status: 503 } });
    await user.click(screen.getByRole("tab", { name: "Product chat" }));
    await user.type(screen.getByLabelText("Catalog product instruction"), "Make it navy");
    await user.click(screen.getByRole("button", { name: "Refine draft" }));
    expect(await screen.findByRole("button", { name: /Retry instruction/i })).toBeInTheDocument();
    expect(screen.getByTestId("contract-product-editor")).toBeInTheDocument();

    api.submitCatalogImageCommand.mockRejectedValueOnce({ response: { status: 503 } });
    await user.click(screen.getByRole("tab", { name: "Product chat" }));
    await user.click(screen.getByRole("tab", { name: "Legacy images" }));
    await user.click(screen.getByRole("button", { name: /Generate primary image/i }));
    expect(await screen.findByRole("button", { name: /Retry image action/i })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Product details" }));
    expect(screen.getByTestId("contract-product-editor")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Product chat" }));
    await user.click(screen.getByRole("button", { name: "Simulate voice failure" }));
    expect(await screen.findByText("Voice is unavailable; continue with text.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Product details" }));
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
