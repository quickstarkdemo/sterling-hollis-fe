import { beforeEach, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  interceptors: { request: { use: vi.fn() } },
}));

vi.mock("axios", () => ({
  default: { create: () => client },
}));

import {
  archiveAdminCatalogProduct,
  archiveAdminCatalogProductV2,
  approveCatalogImageJob,
  createAdminCatalogBrand,
  createCatalogRealtimeSession,
  getAdminCatalogProduct,
  getAdminCatalogProductV2,
  getAdminCatalogProducts,
  getAdminCatalogProductsV2,
  getAdminCatalogReferences,
  getCatalogImageJob,
  getCatalogStudioSession,
  getCatalogWorkflow,
  getDemoObservabilityState,
  getProduct,
  publishAdminCatalogProduct,
  publishAdminCatalogProductV2,
  resetDemoObservabilityState,
  saveAdminCatalogProductDraft,
  saveAdminCatalogProductDraftV2,
  startCatalogWorkflow,
  startAdminCatalogProductRevision,
  startAdminCatalogProductRevisionV2,
  submitCatalogDraftCommand,
  submitCatalogImageCommand,
  submitCatalogMediaCommand,
  submitCatalogRealtimeToolCall,
  submitCatalogRealtimeV3ToolCall,
  updateDemoObservabilityState,
} from "./apiClient";

beforeEach(() => {
  client.get.mockReset().mockResolvedValue({ data: {} });
  client.post.mockReset().mockResolvedValue({ data: {} });
  client.put.mockReset().mockResolvedValue({ data: {} });
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

it("uses the protected versioned catalog lifecycle contract", async () => {
  await getAdminCatalogProducts({ lifecycle_status: "draft", page: 2 });
  await getAdminCatalogProduct("cat/one");
  await startAdminCatalogProductRevision("cat/one", { expected_version: 3 }, "revision-key");
  await saveAdminCatalogProductDraft("cat/one", { expected_version: 3 }, "save-key");
  await publishAdminCatalogProduct("cat/one", { draft_id: "draft_1", expected_version: 3 }, "publish-key");
  await archiveAdminCatalogProduct("cat/one", { expected_version: 4 }, "archive-key");

  expect(client.get).toHaveBeenNthCalledWith(1, "/api/admin/catalog/products", {
    params: { lifecycle_status: "draft", page: 2 },
  });
  expect(client.get).toHaveBeenNthCalledWith(2, "/api/admin/catalog/products/cat%2Fone", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(
    1,
    "/api/admin/catalog/products/cat%2Fone/revisions",
    { expected_version: 3 },
    { headers: { "Idempotency-Key": "revision-key" } },
  );
  expect(client.put).toHaveBeenCalledWith(
    "/api/admin/catalog/products/cat%2Fone/draft",
    { expected_version: 3 },
    { headers: { "Idempotency-Key": "save-key" } },
  );
  expect(client.post).toHaveBeenNthCalledWith(
    2,
    "/api/admin/catalog/products/cat%2Fone/publish",
    { draft_id: "draft_1", expected_version: 3 },
    { headers: { "Idempotency-Key": "publish-key" } },
  );
  expect(client.post).toHaveBeenNthCalledWith(
    3,
    "/api/admin/catalog/products/cat%2Fone/archive",
    { expected_version: 4 },
    { headers: { "Idempotency-Key": "archive-key" } },
  );
});

it("uses the canonical v2 catalog authoring contract", async () => {
  await getAdminCatalogReferences();
  await createAdminCatalogBrand({ name: "August & Mercer" }, "brand-key");
  await getAdminCatalogProductsV2({ lifecycle_status: "published" });
  await getAdminCatalogProductV2("cat/one");
  await startAdminCatalogProductRevisionV2("cat/one", { expected_version: 3 }, "revision-v2-key");
  await saveAdminCatalogProductDraftV2("cat/one", { expected_version: 3 }, "save-v2-key");
  await publishAdminCatalogProductV2("cat/one", { draft_id: "draft_1", expected_version: 3 }, "publish-v2-key");
  await archiveAdminCatalogProductV2("cat/one", { expected_version: 4 }, "archive-v2-key");

  expect(client.get).toHaveBeenNthCalledWith(1, "/api/admin/catalog/v2/references", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(1, "/api/admin/catalog/v2/brands", { name: "August & Mercer" }, { headers: { "Idempotency-Key": "brand-key" } });
  expect(client.get).toHaveBeenNthCalledWith(2, "/api/admin/catalog/v2/products", { params: { lifecycle_status: "published" } });
  expect(client.get).toHaveBeenNthCalledWith(3, "/api/admin/catalog/v2/products/cat%2Fone", { params: {} });
  expect(client.post).toHaveBeenNthCalledWith(2, "/api/admin/catalog/v2/products/cat%2Fone/revisions", { expected_version: 3 }, { headers: { "Idempotency-Key": "revision-v2-key" } });
  expect(client.put).toHaveBeenCalledWith("/api/admin/catalog/v2/products/cat%2Fone/draft", { expected_version: 3 }, { headers: { "Idempotency-Key": "save-v2-key" } });
  expect(client.post).toHaveBeenNthCalledWith(3, "/api/admin/catalog/v2/products/cat%2Fone/publish", { draft_id: "draft_1", expected_version: 3 }, { headers: { "Idempotency-Key": "publish-v2-key" } });
  expect(client.post).toHaveBeenNthCalledWith(4, "/api/admin/catalog/v2/products/cat%2Fone/archive", { expected_version: 4 }, { headers: { "Idempotency-Key": "archive-v2-key" } });
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
  await submitCatalogRealtimeToolCall("workflow/one", {
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
