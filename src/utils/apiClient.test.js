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
  updateDemoObservabilityState,
} from "./apiClient";

beforeEach(() => {
  client.get.mockReset().mockResolvedValue({ data: {} });
  client.post.mockReset().mockResolvedValue({ data: {} });
  client.put.mockReset().mockResolvedValue({ data: {} });
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
  await createCatalogRealtimeSession("workflow/one");
  await submitCatalogRealtimeToolCall("workflow/one", {
    call_id: "call_1",
    name: "refine_catalog_draft",
    arguments: {
      instruction: "Make it ivory",
      current_draft_id: "draft_1",
      expected_draft_version: 1,
    },
  }, "voice-call-key");

  expect(client.post).toHaveBeenNthCalledWith(
    1,
    "/api/admin/catalog/workflows/workflow%2Fone/realtime/sessions",
    undefined,
    undefined,
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
