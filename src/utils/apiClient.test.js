import { beforeEach, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  get: vi.fn(),
  delete: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}));

vi.mock("axios", () => ({
  default: { create: () => client },
}));

import {
  API_HELPER_CONTRACTS,
  archiveAdminCatalogProduct,
  archiveAdminCatalogProductCurrentV2,
  assistCatalogProductReview,
  approveCatalogImageJob,
  createAdminCatalogBrand,
  createCatalogRealtimeSession,
  createShopperRealtimeSession,
  decideCatalogSuggestionSet,
  decideCatalogProductReview,
  deleteCatalogSourceAsset,
  generateCatalogSuggestionSet,
  getAdminApiTrace,
  getAdminApiTraceEvents,
  getAdminApiTraces,
  getAdminCatalogProduct,
  getAdminCatalogProductReviews,
  getAdminCatalogProductCompatibilityV2,
  getAdminCatalogProductV3,
  getAdminCatalogProductPreviewV3,
  getAdminCatalogProductReadinessV3,
  getAdminCatalogProductsCompatibility,
  getAdminCatalogReferences,
  getCatalogImageJob,
  getCatalogSourceBundles,
  getCatalogSourcePreview,
  getCatalogSuggestionSets,
  getCatalogStudioSession,
  getCatalogWorkflow,
  getDemoObservabilityState,
  getProduct,
  getShopperRealtimeCapability,
  publishAdminCatalogProduct,
  publishAdminCatalogProductCompatibilityV2,
  publishAdminCatalogProductV3,
  postApiTraceEvent,
  promoteCatalogSourceAsset,
  resetDemoObservabilityState,
  saveAdminCatalogProductDraft,
  saveAdminCatalogProductDraftCompatibilityV2,
  saveAdminCatalogProductDraftV3,
  setAuthTokenGetter,
  startCatalogWorkflow,
  startAdminCatalogProductRevision,
  startAdminCatalogProductRevisionCompatibilityV2,
  startAdminCatalogProductRevisionV3,
  submitCatalogDraftCommand,
  submitCatalogImageCommand,
  submitCatalogMediaCommand,
  submitCatalogRealtimeCompatibilityToolCall,
  submitCatalogRealtimeV3ToolCall,
  submitShopperRealtimeToolCall,
  subscribeAdminApiTraceEvents,
  updateDemoObservabilityState,
  uploadCatalogSourceBundle,
} from "./apiClient";
import backendCapabilityManifest from "../contracts/backendCapabilityManifest.json";

beforeEach(() => {
  client.get.mockReset().mockResolvedValue({ data: {} });
  client.delete.mockReset().mockResolvedValue({ data: undefined });
  client.post.mockReset().mockResolvedValue({ data: {} });
  client.put.mockReset().mockResolvedValue({ data: {} });
});

it("uses private source and versioned suggestion contracts", async () => {
  const file = new File(["image"], "front.jpg", { type: "image/jpeg" });
  await uploadCatalogSourceBundle([file], {
    title: "Supplier handoff",
    catalogProductId: "cat/one",
    draftRevisionId: "draft_one",
  });
  const uploadCall = client.post.mock.calls[0];
  expect(uploadCall[0]).toBe("/api/admin/catalog/source-bundles");
  expect([...uploadCall[1].entries()]).toEqual(expect.arrayContaining([
    ["title", "Supplier handoff"],
    ["catalog_product_id", "cat/one"],
    ["draft_revision_id", "draft_one"],
    ["files", file],
  ]));

  await getCatalogSourceBundles();
  await getCatalogSourcePreview("/api/admin/catalog/source-bundles/bundle/assets/asset/preview");
  await expect(getCatalogSourcePreview("https://example.com/private.jpg")).rejects.toThrow("invalid_catalog_source_preview_url");
  await deleteCatalogSourceAsset("bundle/one", "asset/one");
  await promoteCatalogSourceAsset("bundle/one", "asset/one", { draft_id: "draft_one", expected_draft_version: 2 }, "promote-key");
  await generateCatalogSuggestionSet("cat/one", { draft_id: "draft_one" }, "generate-key");
  await getCatalogSuggestionSets("cat/one");
  await decideCatalogSuggestionSet("cat/one", "set/one", { action: "accept" }, "decision-key");

  expect(client.delete).toHaveBeenCalledWith("/api/admin/catalog/source-bundles/bundle%2Fone/assets/asset%2Fone");
  expect(client.post).toHaveBeenCalledWith(
    "/api/admin/catalog/source-bundles/bundle%2Fone/assets/asset%2Fone/promote",
    { draft_id: "draft_one", expected_draft_version: 2 },
    { headers: { "Idempotency-Key": "promote-key" } },
  );
  expect(client.post).toHaveBeenCalledWith(
    "/api/admin/catalog/v3/products/cat%2Fone/ai-suggestion-sets",
    { draft_id: "draft_one" },
    { headers: { "Idempotency-Key": "generate-key" } },
  );
  expect(client.get).toHaveBeenCalledWith("/api/admin/catalog/v3/products/cat%2Fone/suggestion-sets", { params: {} });
  expect(client.post).toHaveBeenCalledWith(
    "/api/admin/catalog/v3/products/cat%2Fone/suggestion-sets/set%2Fone/decisions",
    { action: "accept" },
    { headers: { "Idempotency-Key": "decision-key" } },
  );
});

it("uses protected versioned product-review moderation contracts", async () => {
  await getAdminCatalogProductReviews("cat/one");
  await assistCatalogProductReview("cat/one", "review/one", { expected_version: 1 }, "assist-key");
  await decideCatalogProductReview("cat/one", "review/one", {
    action: "approve",
    expected_version: 2,
    reason: "Verified customer feedback.",
  }, "decision-key");

  expect(client.get).toHaveBeenCalledWith(
    "/api/admin/catalog/products/cat%2Fone/reviews",
    { params: {} },
  );
  expect(client.post).toHaveBeenNthCalledWith(
    1,
    "/api/admin/catalog/products/cat%2Fone/reviews/review%2Fone/assist",
    { expected_version: 1 },
    { headers: { "Idempotency-Key": "assist-key" } },
  );
  expect(client.post).toHaveBeenNthCalledWith(
    2,
    "/api/admin/catalog/products/cat%2Fone/reviews/review%2Fone/decisions",
    { action: "approve", expected_version: 2, reason: "Verified customer feedback." },
    { headers: { "Idempotency-Key": "decision-key" } },
  );
});

it("adapts legacy-only product detail into canonical public fields", async () => {
  client.get.mockResolvedValueOnce({ data: {
    id: "cat_legacy",
    title: "Legacy Coat",
    variants: [{
      id: "var_legacy",
      price_min: 180,
      price_max: 220,
      image_url: "https://example.com/legacy.jpg",
      attributes: { color: "navy" },
      inventory: [{ store_id: "1001", availability: "in_stock", inventory_qty: 3 }],
    }],
  } });

  const detail = await getProduct("cat/legacy");

  expect(client.get).toHaveBeenCalledWith("/api/products/cat%2Flegacy", { params: {} });
  expect(detail).toMatchObject({
    price: 180,
    price_min: 180,
    price_max: 220,
    attributes: { color: "navy" },
    images: { primary_url: "https://example.com/legacy.jpg" },
    inventory_summary: { availability: "in_stock", in_stock_units: 3, store_count: 1 },
  });
  expect(detail.inventory).toHaveLength(1);
});

it("keeps explicit canonical empty fields authoritative over legacy projections", async () => {
  client.get.mockResolvedValueOnce({ data: {
    id: "cat_canonical",
    title: "Canonical Coat",
    price_min: 0,
    price_max: 0,
    attributes: {},
    images: null,
    inventory: [],
    variants: [{
      id: "var_legacy",
      price_min: 180,
      price_max: 220,
      image_url: "https://example.com/stale-legacy.jpg",
      attributes: { color: "navy" },
      inventory: [{ store_id: "1001", availability: "in_stock", inventory_qty: 3 }],
    }],
  } });

  const detail = await getProduct("cat_canonical");

  expect(detail).toMatchObject({
    price: 0,
    price_min: 0,
    price_max: 0,
    attributes: {},
    images: null,
    inventory: [],
    inventory_summary: { availability: "out_of_stock", in_stock_units: 0, store_count: 0 },
  });
});

it("uses the current catalog lifecycle contract with an explicit list compatibility dependency", async () => {
  await getAdminCatalogProductsCompatibility({ lifecycle_status: "draft", page: 2 });
  await getAdminCatalogProduct("cat/one");
  await startAdminCatalogProductRevision("cat/one", { expected_version: 3 }, "revision-key");
  await saveAdminCatalogProductDraft("cat/one", { expected_version: 3 }, "save-key");
  await publishAdminCatalogProduct("cat/one", { draft_id: "draft_1", expected_version: 3 }, "publish-key");
  await archiveAdminCatalogProduct("cat/one", { expected_version: 4 }, "archive-key");

  expect(client.get).toHaveBeenNthCalledWith(1, "/api/admin/catalog/v2/products", {
    params: { lifecycle_status: "draft", page: 2 },
  });
  expect(client.get).toHaveBeenNthCalledWith(2, "/api/admin/catalog/v3/products/cat%2Fone", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(
    1,
    "/api/admin/catalog/v3/products/cat%2Fone/revisions",
    { expected_version: 3 },
    { headers: { "Idempotency-Key": "revision-key" } },
  );
  expect(client.put).toHaveBeenCalledWith(
    "/api/admin/catalog/v3/products/cat%2Fone/draft",
    { expected_version: 3 },
    { headers: { "Idempotency-Key": "save-key" } },
  );
  expect(client.post).toHaveBeenNthCalledWith(
    2,
    "/api/admin/catalog/v3/products/cat%2Fone/publish",
    { draft_id: "draft_1", expected_version: 3 },
    { headers: { "Idempotency-Key": "publish-key" } },
  );
  expect(client.post).toHaveBeenNthCalledWith(
    3,
    "/api/admin/catalog/v2/products/cat%2Fone/archive",
    { expected_version: 4 },
    { headers: { "Idempotency-Key": "archive-key" } },
  );
});

it("keeps frontend API helpers aligned with backend capability contract status", () => {
  const manifestByRoute = new Map(
    backendCapabilityManifest.operations.map((operation) => [
      `${operation.method} ${operation.pathTemplate}`,
      operation,
    ]),
  );

  API_HELPER_CONTRACTS.forEach((helper) => {
    const route = manifestByRoute.get(`${helper.method} ${helper.pathTemplate}`);
    expect(route, `${helper.helperName} is missing from the backend capability manifest`).toBeTruthy();
    const compatibilityRoute = route.contractStatus === "compatibility" || route.currentFrontendContract === false;
    if (!compatibilityRoute) return;
    expect(
      helper.compatibilityShim,
      `${helper.helperName} points at ${helper.method} ${helper.pathTemplate}, which backend marks ${route.contractStatus}`,
    ).toBe(true);
    expect(`${helper.helperName} ${helper.reason || ""}`).toMatch(/compatibility|exception/i);
  });
});

it("keeps v2 compatibility product authoring helpers and current v2 exceptions explicit", async () => {
  await getAdminCatalogReferences();
  await createAdminCatalogBrand({ name: "August & Mercer" }, "brand-key");
  await getAdminCatalogProductsCompatibility({ lifecycle_status: "published" });
  await getAdminCatalogProductCompatibilityV2("cat/one");
  await startAdminCatalogProductRevisionCompatibilityV2("cat/one", { expected_version: 3 }, "revision-v2-key");
  await saveAdminCatalogProductDraftCompatibilityV2("cat/one", { expected_version: 3 }, "save-v2-key");
  await publishAdminCatalogProductCompatibilityV2("cat/one", { draft_id: "draft_1", expected_version: 3 }, "publish-v2-key");
  await archiveAdminCatalogProductCurrentV2("cat/one", { expected_version: 4 }, "archive-v2-key");

  expect(client.get).toHaveBeenNthCalledWith(1, "/api/admin/catalog/v2/references", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(1, "/api/admin/catalog/v2/brands", { name: "August & Mercer" }, { headers: { "Idempotency-Key": "brand-key" } });
  expect(client.get).toHaveBeenNthCalledWith(2, "/api/admin/catalog/v2/products", { params: { lifecycle_status: "published" } });
  expect(client.get).toHaveBeenNthCalledWith(3, "/api/admin/catalog/v2/products/cat%2Fone", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(2, "/api/admin/catalog/v2/products/cat%2Fone/revisions", { expected_version: 3 }, { headers: { "Idempotency-Key": "revision-v2-key" } });
  expect(client.put).toHaveBeenCalledWith("/api/admin/catalog/v2/products/cat%2Fone/draft", { expected_version: 3 }, { headers: { "Idempotency-Key": "save-v2-key" } });
  expect(client.post).toHaveBeenNthCalledWith(3, "/api/admin/catalog/v2/products/cat%2Fone/publish", { draft_id: "draft_1", expected_version: 3 }, { headers: { "Idempotency-Key": "publish-v2-key" } });
  expect(client.post).toHaveBeenNthCalledWith(4, "/api/admin/catalog/v2/products/cat%2Fone/archive", { expected_version: 4 }, { headers: { "Idempotency-Key": "archive-v2-key" } });
});

it("uses the structured v3 draft, preview, readiness, and publish contracts", async () => {
  await getAdminCatalogProductV3("cat/one");
  await startAdminCatalogProductRevisionV3("cat/one", { expected_version: 3 }, "revision-v3-key");
  await saveAdminCatalogProductDraftV3("cat/one", { expected_version: 3 }, "save-v3-key");
  await getAdminCatalogProductPreviewV3("cat/one", "draft/one");
  await getAdminCatalogProductReadinessV3("cat/one", "draft/one");
  await publishAdminCatalogProductV3("cat/one", { draft_id: "draft/one", expected_version: 3 }, "publish-v3-key");

  expect(client.get).toHaveBeenNthCalledWith(1, "/api/admin/catalog/v3/products/cat%2Fone", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(1, "/api/admin/catalog/v3/products/cat%2Fone/revisions", { expected_version: 3 }, { headers: { "Idempotency-Key": "revision-v3-key" } });
  expect(client.put).toHaveBeenCalledWith("/api/admin/catalog/v3/products/cat%2Fone/draft", { expected_version: 3 }, { headers: { "Idempotency-Key": "save-v3-key" } });
  expect(client.get).toHaveBeenNthCalledWith(2, "/api/admin/catalog/v3/products/cat%2Fone/drafts/draft%2Fone/preview", { params: {} });
  expect(client.get).toHaveBeenNthCalledWith(3, "/api/admin/catalog/v3/products/cat%2Fone/drafts/draft%2Fone/readiness", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(2, "/api/admin/catalog/v3/products/cat%2Fone/publish", { draft_id: "draft/one", expected_version: 3 }, { headers: { "Idempotency-Key": "publish-v3-key" } });
});

it("uses only protected browser API routes for administrator operations", async () => {
  await getCatalogStudioSession("clerk-token");
  await getDemoObservabilityState();
  await updateDemoObservabilityState({ mode: "off" });
  await resetDemoObservabilityState();

  expect(client.get).toHaveBeenNthCalledWith(1, "/api/admin/session", {
    headers: { Authorization: "Bearer clerk-token" },
  });
  expect(client.get).toHaveBeenNthCalledWith(2, "/api/demo/observability", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(1, "/api/demo/observability", { mode: "off" }, undefined);
  expect(client.post).toHaveBeenNthCalledWith(2, "/api/demo/observability/reset", undefined, undefined);
  expect(client.get.mock.calls.flat().join(" ")).not.toContain("/admin/demo");
  expect(client.post.mock.calls.flat().join(" ")).not.toContain("/admin/demo");
});

it("posts trace events through the untraced authenticated client", async () => {
  const event = {
    event_id: "evt_one",
    event_type: "ui.completed",
    name: "Action completed",
    occurred_at: "2026-06-19T21:00:00Z",
    attributes: {},
  };

  await postApiTraceEvent("trace/one", event);

  expect(client.post).toHaveBeenCalledWith(
    "/api/admin/traces/trace%2Fone/events",
    event,
    { apiTrace: false, timeout: 5000 },
  );
});

it("preserves trace headers when the Clerk interceptor attaches authorization", async () => {
  setAuthTokenGetter(() => Promise.resolve("clerk-token"));
  const attachAuth = client.interceptors.request.use.mock.calls[0][0];
  const traceparent = `00-${"1".repeat(32)}-${"2".repeat(16)}-01`;
  try {
    const config = await attachAuth({ headers: { traceparent } });

    expect(config.headers).toEqual({
      Authorization: "Bearer clerk-token",
      traceparent,
    });
  } finally {
    setAuthTokenGetter(null);
  }
});

it("uses production Catalog Workflow routes for guided creation and images", async () => {
  await startCatalogWorkflow({ title: "New coat", business_summary: "Create a coat" }, "workflow-key");
  await getCatalogWorkflow("workflow/one", { developer: true });
  await submitCatalogDraftCommand("workflow/one", { instruction: "Create it", expected_draft_version: 0 }, "draft-key");
  await submitCatalogImageCommand("workflow/one", { draft_id: "draft_1", expected_draft_version: 1 }, "image-key");
  await submitCatalogMediaCommand("workflow/one", { draft_id: "draft_1", source_media_id: "media_core", intent: "scene" }, "media-key");
  await getCatalogImageJob("workflow/one", "job/one");
  await approveCatalogImageJob("workflow/one", "job/one", { draft_id: "draft_1", expected_draft_version: 1 }, "approve-key");

  expect(client.post).toHaveBeenNthCalledWith(1, "/api/admin/catalog/workflows", {
    title: "New coat",
    business_summary: "Create a coat",
  }, { headers: { "Idempotency-Key": "workflow-key" } });
  expect(client.get).toHaveBeenNthCalledWith(1, "/api/admin/catalog/workflows/workflow%2Fone", {
    params: { developer: "true" },
  });
  expect(client.post).toHaveBeenNthCalledWith(2, "/api/admin/catalog/workflows/workflow%2Fone/draft-commands", {
    instruction: "Create it",
    expected_draft_version: 0,
  }, { headers: { "Idempotency-Key": "draft-key" } });
  expect(client.post).toHaveBeenNthCalledWith(3, "/api/admin/catalog/workflows/workflow%2Fone/image-commands", {
    draft_id: "draft_1",
    expected_draft_version: 1,
  }, { headers: { "Idempotency-Key": "image-key" } });
  expect(client.post).toHaveBeenNthCalledWith(4, "/api/admin/catalog/workflows/workflow%2Fone/media-commands", {
    draft_id: "draft_1",
    source_media_id: "media_core",
    intent: "scene",
  }, { headers: { "Idempotency-Key": "media-key" } });
  expect(client.get).toHaveBeenNthCalledWith(2, "/api/admin/catalog/workflows/workflow%2Fone/image-jobs/job%2Fone", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(5, "/api/admin/catalog/workflows/workflow%2Fone/image-jobs/job%2Fone/approve", {
    draft_id: "draft_1",
    expected_draft_version: 1,
  }, { headers: { "Idempotency-Key": "approve-key" } });
  expect(client.post.mock.calls.flat().join(" ")).not.toContain("demo-runs");
  expect(client.get.mock.calls.flat().join(" ")).not.toContain("demo-runs");
});

it("uses workflow-bound Realtime routes without exposing provider credentials", async () => {
  const context = { mode: "workbench", product_id: "cat_1", draft_id: "draft_1", expected_draft_version: 1, query_scopes: ["product"] };
  await createCatalogRealtimeSession("workflow/one", context);
  await submitCatalogRealtimeCompatibilityToolCall("workflow/one", {
    call_id: "call_1",
    name: "refine_catalog_draft",
    arguments: {
      instruction: "Make it ivory",
      current_draft_id: "draft_1",
      expected_draft_version: 1,
    },
  }, "voice-call-key");
  await submitCatalogRealtimeV3ToolCall("workflow/one", {
    session_id: "session_1",
    call_id: "call_2",
    name: "read_product_summary",
    arguments: { question: "What product is active?" },
  }, "voice-v3-key");

  expect(client.post).toHaveBeenNthCalledWith(
    1,
    "/api/admin/catalog/workflows/workflow%2Fone/realtime/sessions",
    context,
    undefined,
  );
  expect(client.post).toHaveBeenNthCalledWith(
    3,
    "/api/admin/catalog/workflows/workflow%2Fone/realtime/v3/tool-calls",
    expect.objectContaining({ session_id: "session_1", name: "read_product_summary" }),
    { headers: { "Idempotency-Key": "voice-v3-key" } },
  );
  expect(client.post).toHaveBeenNthCalledWith(
    2,
    "/api/admin/catalog/workflows/workflow%2Fone/realtime/tool-calls",
    expect.objectContaining({ call_id: "call_1", name: "refine_catalog_draft" }),
    { headers: { "Idempotency-Key": "voice-call-key" } },
  );
  expect(JSON.stringify(client.post.mock.calls)).not.toContain("client_secret");
  expect(JSON.stringify(client.post.mock.calls)).not.toContain("api.openai.com");
});

it("uses shopper Realtime routes without exposing provider credentials", async () => {
  await getShopperRealtimeCapability();
  await createShopperRealtimeSession({ context: { route: "/", store_id: "1001" } });
  await submitShopperRealtimeToolCall({
    session_id: "shopper_realtime_1",
    call_id: "call_voice_1",
    name: "shopper_chat_turn",
    arguments: { message: "Is this in stock?" },
    context: { route: "/", store_id: "1001" },
  });

  expect(client.get).toHaveBeenNthCalledWith(1, "/api/chat/realtime/capability", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(
    1,
    "/api/chat/realtime/sessions",
    { context: { route: "/", store_id: "1001" } },
    { timeout: 30000 },
  );
  expect(client.post).toHaveBeenNthCalledWith(
    2,
    "/api/chat/realtime/tool-calls",
    expect.objectContaining({
      session_id: "shopper_realtime_1",
      name: "shopper_chat_turn",
    }),
    { timeout: 90000 },
  );
  expect(JSON.stringify(client.post.mock.calls)).not.toContain("client_secret");
  expect(JSON.stringify(client.post.mock.calls)).not.toContain("api.openai.com");
});

it("uses non-tracing admin routes for trace projections", async () => {
  client.get
    .mockResolvedValueOnce({ data: { items: [] } })
    .mockResolvedValueOnce({ data: { trace_id: "trace/one" } })
    .mockResolvedValueOnce({ data: { items: [], next_cursor: 3 } });

  await getAdminApiTraces({ limit: 12 });
  await getAdminApiTrace("trace/one");
  await getAdminApiTraceEvents("trace/one", 3);

  expect(client.get).toHaveBeenNthCalledWith(1, "/api/admin/traces", {
    params: { limit: 12 },
    apiTrace: false,
  });
  expect(client.get).toHaveBeenNthCalledWith(2, "/api/admin/traces/trace%2Fone", { apiTrace: false });
  expect(client.get).toHaveBeenNthCalledWith(3, "/api/admin/traces/trace%2Fone/events", {
    params: { after_sequence: 3 },
    apiTrace: false,
  });
});

it("streams authenticated trace events without putting credentials in the URL", async () => {
  const event = { event_id: "evt-1", sequence: 4, name: "Completed" };
  const read = vi.fn()
    .mockResolvedValueOnce({
      done: false,
      value: new TextEncoder().encode(`id: 4\nevent: trace_event\ndata: ${JSON.stringify(event)}\n\n`),
    })
    .mockResolvedValueOnce({ done: true });
  const releaseLock = vi.fn();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    body: { getReader: () => ({ read, releaseLock }) },
  });
  const onEvent = vi.fn();
  const onStatus = vi.fn();
  setAuthTokenGetter(() => Promise.resolve("clerk-token"));

  try {
    const result = await subscribeAdminApiTraceEvents("trace/one", { afterSequence: 3, onEvent, onStatus });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/traces/trace%2Fone/stream?after_sequence=3",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer clerk-token" }),
      }),
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain("clerk-token");
    expect(onStatus).toHaveBeenCalledWith("live");
    expect(onEvent).toHaveBeenCalledWith({ type: "trace_event", data: event });
    expect(result).toMatchObject({
      closeReason: "stream_closed",
      expected: false,
      httpStatus: 200,
      lastEventSequence: 4,
    });
    expect(releaseLock).toHaveBeenCalled();
  } finally {
    setAuthTokenGetter(null);
    fetchMock.mockRestore();
  }
});

it("classifies intentional trace stream aborts without reporting a fetch failure", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const controller = new AbortController();
  controller.abort();

  try {
    const result = await subscribeAdminApiTraceEvents("trace/one", {
      afterSequence: 7,
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      closeReason: "client_abort",
      expected: true,
      lastEventSequence: 7,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    fetchMock.mockRestore();
  }
});

it("reports non-abort trace stream failures with close metadata", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));

  try {
    await expect(subscribeAdminApiTraceEvents("trace/one", { afterSequence: 3 }))
      .rejects.toMatchObject({
        name: "ApiTraceStreamError",
        closeReason: "network_error",
        lastEventSequence: 3,
      });
  } finally {
    fetchMock.mockRestore();
  }
});

it("classifies malformed trace stream payloads as parser failures", async () => {
  const read = vi.fn()
    .mockResolvedValueOnce({
      done: false,
      value: new TextEncoder().encode("event: trace_event\ndata: {not-json}\n\n"),
    });
  const releaseLock = vi.fn();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    body: { getReader: () => ({ read, releaseLock }) },
  });

  try {
    await expect(subscribeAdminApiTraceEvents("trace/one", { afterSequence: 2 }))
      .rejects.toMatchObject({
        name: "ApiTraceStreamError",
        closeReason: "parse_error",
        httpStatus: 200,
        lastEventSequence: 2,
      });
    expect(releaseLock).toHaveBeenCalled();
  } finally {
    fetchMock.mockRestore();
  }
});
