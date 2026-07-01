import axios from "axios";

import {
  installAxiosTraceInterceptors,
  setApiTraceEventTransport,
} from "./apiTraceClient";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "";
export const DEFAULT_STORE_ID = import.meta.env.VITE_DEFAULT_STORE_ID || "";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

const uploadClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 90000,
});

let authTokenGetter = null;

export function setAuthTokenGetter(getter) {
  authTokenGetter = typeof getter === "function" ? getter : null;
}

async function attachAuth(config) {
  if (!authTokenGetter) return config;
  const token = await authTokenGetter();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}

apiClient.interceptors.request.use(attachAuth);
uploadClient.interceptors.request.use(attachAuth);
installAxiosTraceInterceptors(apiClient);
installAxiosTraceInterceptors(uploadClient, { requestKind: "upload" });

const cleanParams = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );

async function get(path, params) {
  const response = await apiClient.get(path, { params: cleanParams(params) });
  return response.data;
}

async function post(path, data, config) {
  const response = await apiClient.post(path, data, config);
  return response.data;
}

async function put(path, data, config) {
  const response = await apiClient.put(path, data, config);
  return response.data;
}

async function postForm(path, formData, config) {
  const response = await uploadClient.post(path, formData, config);
  return response.data;
}

async function remove(path) {
  const response = await apiClient.delete(path);
  return response.data;
}

export async function postApiTraceEvent(traceId, event) {
  const response = await apiClient.post(
    `/api/admin/traces/${encodeURIComponent(traceId)}/events`,
    event,
    { apiTrace: false, timeout: 5000 },
  );
  return response.data;
}

export async function getAdminApiTraces(params = {}) {
  const response = await apiClient.get("/api/admin/traces", {
    params: cleanParams(params),
    apiTrace: false,
  });
  return response.data;
}

export async function getAdminApiTrace(traceId) {
  const response = await apiClient.get(
    `/api/admin/traces/${encodeURIComponent(traceId)}`,
    { apiTrace: false },
  );
  return response.data;
}

export async function getAdminApiTraceEvents(traceId, afterSequence = -1) {
  const response = await apiClient.get(
    `/api/admin/traces/${encodeURIComponent(traceId)}/events`,
    { params: { after_sequence: afterSequence }, apiTrace: false },
  );
  return response.data;
}

function traceStreamNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function traceStreamDuration(startedAt) {
  return Math.max(0, Math.round(traceStreamNow() - startedAt));
}

function traceStreamResult({
  closeReason,
  durationMs,
  expected = false,
  httpStatus = 0,
  lastEventSequence,
}) {
  return {
    closeReason,
    durationMs,
    expected,
    httpStatus,
    lastEventSequence,
  };
}

function isAbortLike(error, signal) {
  return Boolean(signal?.aborted || error?.name === "AbortError" || error?.code === "ABORT_ERR");
}

function traceStreamError(message, details = {}) {
  const error = new Error(message);
  error.name = "ApiTraceStreamError";
  Object.assign(error, details);
  return error;
}

export async function downloadAdminApiTrace(traceId) {
  const response = await apiClient.get(
    `/api/admin/traces/${encodeURIComponent(traceId)}/export`,
    { apiTrace: false, responseType: "blob" },
  );
  return response;
}

export async function subscribeAdminApiTraceEvents(
  traceId,
  { afterSequence = -1, signal, onEvent = () => {}, onStatus = () => {} } = {},
) {
  const startedAt = traceStreamNow();
  let lastEventSequence = Number(afterSequence);
  const finish = (closeReason, values = {}) => traceStreamResult({
    closeReason,
    durationMs: traceStreamDuration(startedAt),
    httpStatus: values.httpStatus || 0,
    lastEventSequence,
    expected: Boolean(values.expected),
  });
  if (signal?.aborted) return finish("client_abort", { expected: true });

  const token = authTokenGetter ? await authTokenGetter() : "";
  const query = new URLSearchParams({ after_sequence: String(afterSequence) });
  let response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/admin/traces/${encodeURIComponent(traceId)}/stream?${query}`,
      {
        cache: "no-store",
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal,
      },
    );
  } catch (error) {
    if (isAbortLike(error, signal)) return finish("client_abort", { expected: true });
    throw traceStreamError("Trace stream network failure.", {
      closeReason: "network_error",
      durationMs: traceStreamDuration(startedAt),
      lastEventSequence,
      originalError: error,
    });
  }
  if (!response.ok) {
    throw traceStreamError(`Trace stream failed with status ${response.status}.`, {
      closeReason: response.status >= 500 ? "server_error" : "http_error",
      durationMs: traceStreamDuration(startedAt),
      httpStatus: response.status,
      lastEventSequence,
      status: response.status,
    });
  }
  if (!response.body?.getReader) {
    throw traceStreamError("Trace streaming is unavailable in this browser.", {
      closeReason: "stream_unavailable",
      durationMs: traceStreamDuration(startedAt),
      httpStatus: response.status,
      lastEventSequence,
      status: response.status,
    });
  }

  onStatus("live");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processBlock = (block) => {
    const lines = block.split(/\r?\n/);
    let eventType = "message";
    const dataLines = [];
    lines.forEach((line) => {
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    });
    if (!dataLines.length) return;
    let data;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch (error) {
      throw traceStreamError("Trace stream event could not be parsed.", {
        closeReason: "parse_error",
        durationMs: traceStreamDuration(startedAt),
        httpStatus: response.status,
        lastEventSequence,
        status: response.status,
        originalError: error,
      });
    }
    if (eventType === "trace_event" && Number.isFinite(Number(data.sequence))) {
      lastEventSequence = Math.max(lastEventSequence, Number(data.sequence));
    }
    onEvent({ type: eventType, data });
  };

  try {
    while (!signal?.aborted) {
      let next;
      try {
        next = await reader.read();
      } catch (error) {
        if (isAbortLike(error, signal)) return finish("client_abort", { expected: true, httpStatus: response.status });
        throw traceStreamError("Trace stream read failed.", {
          closeReason: "read_error",
          durationMs: traceStreamDuration(startedAt),
          httpStatus: response.status,
          lastEventSequence,
          status: response.status,
          originalError: error,
        });
      }
      const { done, value } = next;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      blocks.forEach(processBlock);
    }
  } finally {
    reader.releaseLock();
  }
  if (signal?.aborted) return finish("client_abort", { expected: true, httpStatus: response.status });
  return finish("stream_closed", { httpStatus: response.status });
}

setApiTraceEventTransport(postApiTraceEvent);

export function getCatalog(params) {
  return get("/api/catalog", params);
}

export function getCategories() {
  return get("/api/categories");
}

export function getProducts(params) {
  return get("/api/products", params);
}

export function getCategoryProducts(category, params) {
  return get(`/api/categories/${encodeURIComponent(category)}/products`, params);
}

function inventorySummary(rows) {
  const state = (row) => String(row.stock_state || row.availability || "").trim().toLowerCase().replace(/\s+/g, "_");
  const inStockRows = rows.filter((row) => state(row) === "in_stock");
  const preorderRows = rows.filter((row) => state(row) === "preorder");
  const stores = new Set(rows.map((row) => row.store_id).filter(Boolean));
  const inStockStores = new Set(inStockRows.map((row) => row.store_id).filter(Boolean));
  const inStockUnits = inStockRows.reduce((total, row) => total + Number(row.inventory_qty || 0), 0);
  const preorderUnits = preorderRows.reduce((total, row) => total + Number(row.inventory_qty || 0), 0);
  return {
    total_units: rows.reduce((total, row) => total + Number(row.inventory_qty || 0), 0),
    in_stock_units: inStockUnits,
    preorder_units: preorderUnits,
    store_count: stores.size,
    in_stock_store_count: inStockStores.size,
    availability: inStockUnits > 0 ? "in_stock" : preorderUnits > 0 ? "preorder" : "out_of_stock",
  };
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function adaptPublicProduct(product) {
  if (!product) return product;
  const variants = product.variants || [];
  const legacyInventory = variants.flatMap((variant) => variant.inventory || []);
  const hasCanonicalInventory = Object.prototype.hasOwnProperty.call(product, "inventory") && Array.isArray(product.inventory);
  const hasCanonicalAttributes = Object.prototype.hasOwnProperty.call(product, "attributes");
  const hasCanonicalImages = Object.prototype.hasOwnProperty.call(product, "images");
  const inventory = hasCanonicalInventory ? product.inventory : legacyInventory;
  const legacyPriceMins = variants.map((variant) => Number(variant.price_min)).filter(Number.isFinite);
  const legacyPriceMaxes = variants.map((variant) => Number(variant.price_max)).filter(Number.isFinite);
  const priceMin = finiteNumber(product.price_min) ?? (legacyPriceMins.length ? Math.min(...legacyPriceMins) : null);
  const priceMax = finiteNumber(product.price_max) ?? (legacyPriceMaxes.length ? Math.max(...legacyPriceMaxes) : null);
  const legacyImages = variants.find((variant) => variant.images || variant.image_url);

  return {
    ...product,
    price: finiteNumber(product.price) ?? priceMin ?? 0,
    price_min: priceMin ?? 0,
    price_max: priceMax ?? priceMin ?? 0,
    attributes: hasCanonicalAttributes
      ? product.attributes || {}
      : variants.find((variant) => Object.keys(variant.attributes || {}).length)?.attributes || {},
    images: hasCanonicalImages
      ? product.images
      : legacyImages?.images || (legacyImages?.image_url ? { primary_url: legacyImages.image_url, detail_urls: [] } : null),
    inventory,
    inventory_summary: product.inventory_summary || inventorySummary(inventory),
  };
}

export async function getProduct(productId, params) {
  return adaptPublicProduct(await get(`/api/products/${encodeURIComponent(productId)}`, params));
}

export function getRelatedProducts(productId, params) {
  return get(`/api/products/${encodeURIComponent(productId)}/related`, params);
}

export function searchProducts(query, params) {
  return get("/api/search/products", { q: query, ...params });
}

export function getProductRecommendations(payload = {}) {
  return post("/api/recommendations/products", {
    store_id: DEFAULT_STORE_ID || undefined,
    top_k: 8,
    include_preorder: true,
    ...payload,
  });
}

export function sendChat(payload = {}) {
  return post("/api/chat", payload, { timeout: 90000 });
}

export function getShopperRealtimeCapability() {
  return get("/api/chat/realtime/capability");
}

export function createShopperRealtimeSession(payload = {}) {
  return post("/api/chat/realtime/sessions", payload, { timeout: 30000 });
}

export function submitShopperRealtimeToolCall(payload = {}) {
  return post("/api/chat/realtime/tool-calls", payload, { timeout: 90000 });
}

export function getDemoObservabilityState() {
  return get("/api/demo/observability");
}

export function updateDemoObservabilityState(payload = {}) {
  return post("/api/demo/observability", payload);
}

export function resetDemoObservabilityState() {
  return post("/api/demo/observability/reset");
}

export async function getCatalogStudioSession(token) {
  const response = await apiClient.get("/api/admin/session", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return response.data;
}

const catalogProductPath = (productId, suffix = "") =>
  `/api/admin/catalog/products/${encodeURIComponent(productId)}${suffix}`;

const catalogProductV2Path = (productId, suffix = "") =>
  `/api/admin/catalog/v2/products/${encodeURIComponent(productId)}${suffix}`;

const catalogProductV3Path = (productId, suffix = "") =>
  `/api/admin/catalog/v3/products/${encodeURIComponent(productId)}${suffix}`;

const idempotencyConfig = (idempotencyKey) => ({
  headers: { "Idempotency-Key": idempotencyKey },
});

export function createIdempotencyKey(scope = "catalog") {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${scope}-${randomPart}`;
}

export function getAdminCatalogReferences() {
  return get("/api/admin/catalog/v2/references");
}

export function createAdminCatalogBrand(payload, idempotencyKey) {
  return post("/api/admin/catalog/v2/brands", payload, idempotencyConfig(idempotencyKey));
}

export function getAdminCatalogProductsCompatibility(params = {}) {
  return get("/api/admin/catalog/v2/products", params);
}

export function getAdminCatalogProductCompatibilityV2(productId) {
  return get(catalogProductV2Path(productId));
}

export function startAdminCatalogProductRevisionCompatibilityV2(productId, payload, idempotencyKey) {
  return post(catalogProductV2Path(productId, "/revisions"), payload, idempotencyConfig(idempotencyKey));
}

export function saveAdminCatalogProductDraftCompatibilityV2(productId, payload, idempotencyKey) {
  return put(catalogProductV2Path(productId, "/draft"), payload, idempotencyConfig(idempotencyKey));
}

export function publishAdminCatalogProductCompatibilityV2(productId, payload, idempotencyKey) {
  return post(catalogProductV2Path(productId, "/publish"), payload, idempotencyConfig(idempotencyKey));
}

export function archiveAdminCatalogProductCurrentV2(productId, payload, idempotencyKey) {
  return post(catalogProductV2Path(productId, "/archive"), payload, idempotencyConfig(idempotencyKey));
}

export function getAdminCatalogProductV3(productId) {
  return get(catalogProductV3Path(productId));
}

export function startAdminCatalogProductRevisionV3(productId, payload, idempotencyKey) {
  return post(catalogProductV3Path(productId, "/revisions"), payload, idempotencyConfig(idempotencyKey));
}

export function saveAdminCatalogProductDraftV3(productId, payload, idempotencyKey) {
  return put(catalogProductV3Path(productId, "/draft"), payload, idempotencyConfig(idempotencyKey));
}

export function publishAdminCatalogProductV3(productId, payload, idempotencyKey) {
  return post(catalogProductV3Path(productId, "/publish"), payload, idempotencyConfig(idempotencyKey));
}

export function getAdminCatalogProductReadinessV3(productId, draftId) {
  return get(catalogProductV3Path(productId, `/drafts/${encodeURIComponent(draftId)}/readiness`));
}

export function getAdminCatalogProductPreviewV3(productId, draftId) {
  return get(catalogProductV3Path(productId, `/drafts/${encodeURIComponent(draftId)}/preview`));
}

export function getAdminCatalogProduct(productId) {
  return getAdminCatalogProductV3(productId);
}

export function startAdminCatalogProductRevision(productId, payload, idempotencyKey) {
  return startAdminCatalogProductRevisionV3(productId, payload, idempotencyKey);
}

export function saveAdminCatalogProductDraft(productId, payload, idempotencyKey) {
  return saveAdminCatalogProductDraftV3(productId, payload, idempotencyKey);
}

export function publishAdminCatalogProduct(productId, payload, idempotencyKey) {
  return publishAdminCatalogProductV3(productId, payload, idempotencyKey);
}

export function archiveAdminCatalogProduct(productId, payload, idempotencyKey) {
  return archiveAdminCatalogProductCurrentV2(productId, payload, idempotencyKey);
}

const catalogWorkflowPath = (workflowId, suffix = "") =>
  `/api/admin/catalog/workflows/${encodeURIComponent(workflowId)}${suffix}`;

export function startCatalogWorkflow(payload, idempotencyKey) {
  return post("/api/admin/catalog/workflows", payload, idempotencyConfig(idempotencyKey));
}

export function getCatalogWorkflow(workflowId, { developer = false } = {}) {
  return get(catalogWorkflowPath(workflowId), { developer: developer ? "true" : undefined });
}

export function submitCatalogDraftCommand(workflowId, payload, idempotencyKey) {
  return post(catalogWorkflowPath(workflowId, "/draft-commands"), payload, idempotencyConfig(idempotencyKey));
}

export function queryCatalogAssistant(payload) {
  return post("/api/admin/catalog/assistant/query", payload);
}

export function createCatalogRealtimeSession(workflowId, context) {
  return post(catalogWorkflowPath(workflowId, "/realtime/sessions"), context);
}

export function submitCatalogRealtimeCompatibilityToolCall(workflowId, payload, idempotencyKey) {
  return post(
    catalogWorkflowPath(workflowId, "/realtime/tool-calls"),
    payload,
    idempotencyConfig(idempotencyKey),
  );
}

export function submitCatalogRealtimeV3ToolCall(workflowId, payload, idempotencyKey) {
  return post(
    catalogWorkflowPath(workflowId, "/realtime/v3/tool-calls"),
    payload,
    idempotencyConfig(idempotencyKey),
  );
}

export const API_HELPER_CONTRACTS = [
  { helperName: "getCatalog", method: "GET", pathTemplate: "/api/catalog" },
  { helperName: "getCategories", method: "GET", pathTemplate: "/api/categories" },
  { helperName: "getProducts", method: "GET", pathTemplate: "/api/products" },
  { helperName: "getCategoryProducts", method: "GET", pathTemplate: "/api/categories/{category}/products" },
  { helperName: "getProduct", method: "GET", pathTemplate: "/api/products/{product_id}" },
  { helperName: "getRelatedProducts", method: "GET", pathTemplate: "/api/products/{product_id}/related" },
  { helperName: "searchProducts", method: "GET", pathTemplate: "/api/search/products" },
  { helperName: "getProductRecommendations", method: "POST", pathTemplate: "/api/recommendations/products" },
  { helperName: "sendChat", method: "POST", pathTemplate: "/api/chat" },
  { helperName: "getShopperRealtimeCapability", method: "GET", pathTemplate: "/api/chat/realtime/capability" },
  { helperName: "createShopperRealtimeSession", method: "POST", pathTemplate: "/api/chat/realtime/sessions" },
  { helperName: "submitShopperRealtimeToolCall", method: "POST", pathTemplate: "/api/chat/realtime/tool-calls" },
  { helperName: "getDemoObservabilityState", method: "GET", pathTemplate: "/api/demo/observability", compatibilityShim: true, reason: "operator demo compatibility surface" },
  { helperName: "updateDemoObservabilityState", method: "POST", pathTemplate: "/api/demo/observability", compatibilityShim: true, reason: "operator demo compatibility surface" },
  { helperName: "resetDemoObservabilityState", method: "POST", pathTemplate: "/api/demo/observability/reset", compatibilityShim: true, reason: "operator demo compatibility surface" },
  { helperName: "getCatalogStudioSession", method: "GET", pathTemplate: "/api/admin/session" },
  { helperName: "getAdminCatalogProductsCompatibility", method: "GET", pathTemplate: "/api/admin/catalog/v2/products", compatibilityShim: true, reason: "no current v3 list route is available yet" },
  { helperName: "getAdminCatalogReferences", method: "GET", pathTemplate: "/api/admin/catalog/v2/references" },
  { helperName: "createAdminCatalogBrand", method: "POST", pathTemplate: "/api/admin/catalog/v2/brands" },
  { helperName: "getAdminCatalogProduct", method: "GET", pathTemplate: "/api/admin/catalog/v3/products/{product_id}" },
  { helperName: "getAdminCatalogProductCompatibilityV2", method: "GET", pathTemplate: "/api/admin/catalog/v2/products/{product_id}", compatibilityShim: true, reason: "legacy schema 2 product editor fallback" },
  { helperName: "startAdminCatalogProductRevision", method: "POST", pathTemplate: "/api/admin/catalog/v3/products/{product_id}/revisions" },
  { helperName: "startAdminCatalogProductRevisionCompatibilityV2", method: "POST", pathTemplate: "/api/admin/catalog/v2/products/{product_id}/revisions", compatibilityShim: true, reason: "legacy schema 2 product editor fallback" },
  { helperName: "saveAdminCatalogProductDraft", method: "PUT", pathTemplate: "/api/admin/catalog/v3/products/{product_id}/draft" },
  { helperName: "saveAdminCatalogProductDraftCompatibilityV2", method: "PUT", pathTemplate: "/api/admin/catalog/v2/products/{product_id}/draft", compatibilityShim: true, reason: "legacy schema 2 product editor fallback" },
  { helperName: "publishAdminCatalogProduct", method: "POST", pathTemplate: "/api/admin/catalog/v3/products/{product_id}/publish" },
  { helperName: "publishAdminCatalogProductCompatibilityV2", method: "POST", pathTemplate: "/api/admin/catalog/v2/products/{product_id}/publish", compatibilityShim: true, reason: "legacy schema 2 product editor fallback" },
  { helperName: "archiveAdminCatalogProduct", method: "POST", pathTemplate: "/api/admin/catalog/v2/products/{product_id}/archive", reason: "current v2 archive exception" },
  { helperName: "getAdminCatalogProductReadinessV3", method: "GET", pathTemplate: "/api/admin/catalog/v3/products/{product_id}/drafts/{draft_id}/readiness" },
  { helperName: "getAdminCatalogProductPreviewV3", method: "GET", pathTemplate: "/api/admin/catalog/v3/products/{product_id}/drafts/{draft_id}/preview" },
  { helperName: "startCatalogWorkflow", method: "POST", pathTemplate: "/api/admin/catalog/workflows" },
  { helperName: "getCatalogWorkflow", method: "GET", pathTemplate: "/api/admin/catalog/workflows/{workflow_id}" },
  { helperName: "submitCatalogDraftCommand", method: "POST", pathTemplate: "/api/admin/catalog/workflows/{workflow_id}/draft-commands" },
  { helperName: "queryCatalogAssistant", method: "POST", pathTemplate: "/api/admin/catalog/assistant/query" },
  { helperName: "createCatalogRealtimeSession", method: "POST", pathTemplate: "/api/admin/catalog/workflows/{workflow_id}/realtime/sessions" },
  { helperName: "submitCatalogRealtimeCompatibilityToolCall", method: "POST", pathTemplate: "/api/admin/catalog/workflows/{workflow_id}/realtime/tool-calls", compatibilityShim: true, reason: "legacy create/refine draft voice tools" },
  { helperName: "submitCatalogRealtimeV3ToolCall", method: "POST", pathTemplate: "/api/admin/catalog/workflows/{workflow_id}/realtime/v3/tool-calls" },
  { helperName: "getAdminCatalogProductReviews", method: "GET", pathTemplate: "/api/admin/catalog/products/{product_id}/reviews" },
  { helperName: "assistCatalogProductReview", method: "POST", pathTemplate: "/api/admin/catalog/products/{product_id}/reviews/{review_id}/assist" },
  { helperName: "decideCatalogProductReview", method: "POST", pathTemplate: "/api/admin/catalog/products/{product_id}/reviews/{review_id}/decisions" },
  { helperName: "getAdminApiTraces", method: "GET", pathTemplate: "/api/admin/traces" },
  { helperName: "getAdminApiTrace", method: "GET", pathTemplate: "/api/admin/traces/{trace_id}" },
  { helperName: "getAdminApiTraceEvents", method: "GET", pathTemplate: "/api/admin/traces/{trace_id}/events" },
  { helperName: "postApiTraceEvent", method: "POST", pathTemplate: "/api/admin/traces/{trace_id}/events" },
  { helperName: "downloadAdminApiTrace", method: "GET", pathTemplate: "/api/admin/traces/{trace_id}/export" },
  { helperName: "subscribeAdminApiTraceEvents", method: "GET", pathTemplate: "/api/admin/traces/{trace_id}/stream" },
];

export function uploadCatalogSourceBundle(files, fields = {}, onUploadProgress) {
  const formData = new FormData();
  formData.append("title", fields.title || "Supplier source bundle");
  if (fields.catalogProductId) formData.append("catalog_product_id", fields.catalogProductId);
  if (fields.draftRevisionId) formData.append("draft_revision_id", fields.draftRevisionId);
  files.forEach((file) => formData.append("files", file));
  return postForm("/api/admin/catalog/source-bundles", formData, { onUploadProgress });
}

export function getCatalogSourceBundles() {
  return get("/api/admin/catalog/source-bundles");
}

export async function getCatalogSourcePreview(previewUrl) {
  if (!String(previewUrl).startsWith("/api/admin/catalog/source-bundles/")) {
    throw new Error("invalid_catalog_source_preview_url");
  }
  const response = await apiClient.get(previewUrl, { responseType: "blob" });
  return response.data;
}

export function deleteCatalogSourceAsset(bundleId, assetId) {
  return remove(`/api/admin/catalog/source-bundles/${encodeURIComponent(bundleId)}/assets/${encodeURIComponent(assetId)}`);
}

export function promoteCatalogSourceAsset(bundleId, assetId, payload, idempotencyKey) {
  return post(
    `/api/admin/catalog/source-bundles/${encodeURIComponent(bundleId)}/assets/${encodeURIComponent(assetId)}/promote`,
    payload,
    idempotencyConfig(idempotencyKey),
  );
}

export function generateCatalogSuggestionSet(productId, payload, idempotencyKey) {
  return post(
    `/api/admin/catalog/v3/products/${encodeURIComponent(productId)}/ai-suggestion-sets`,
    payload,
    idempotencyConfig(idempotencyKey),
  );
}

export function getCatalogSuggestionSets(productId) {
  return get(`/api/admin/catalog/v3/products/${encodeURIComponent(productId)}/suggestion-sets`);
}

export function decideCatalogSuggestionSet(productId, suggestionSetId, payload, idempotencyKey) {
  return post(
    `/api/admin/catalog/v3/products/${encodeURIComponent(productId)}/suggestion-sets/${encodeURIComponent(suggestionSetId)}/decisions`,
    payload,
    idempotencyConfig(idempotencyKey),
  );
}

export function getAdminCatalogProductReviews(productId) {
  return get(catalogProductPath(productId, "/reviews"));
}

export function assistCatalogProductReview(productId, reviewId, payload, idempotencyKey) {
  return post(
    catalogProductPath(productId, `/reviews/${encodeURIComponent(reviewId)}/assist`),
    payload,
    idempotencyConfig(idempotencyKey),
  );
}

export function decideCatalogProductReview(productId, reviewId, payload, idempotencyKey) {
  return post(
    catalogProductPath(productId, `/reviews/${encodeURIComponent(reviewId)}/decisions`),
    payload,
    idempotencyConfig(idempotencyKey),
  );
}

export function submitCatalogImageCommand(workflowId, payload, idempotencyKey) {
  return post(catalogWorkflowPath(workflowId, "/image-commands"), payload, idempotencyConfig(idempotencyKey));
}

export function submitCatalogMediaCommand(workflowId, payload, idempotencyKey) {
  return post(catalogWorkflowPath(workflowId, "/media-commands"), payload, idempotencyConfig(idempotencyKey));
}

export function getCatalogImageJob(workflowId, jobId) {
  return get(catalogWorkflowPath(workflowId, `/image-jobs/${encodeURIComponent(jobId)}`));
}

export function approveCatalogImageJob(workflowId, jobId, payload, idempotencyKey) {
  return post(
    catalogWorkflowPath(workflowId, `/image-jobs/${encodeURIComponent(jobId)}/approve`),
    payload,
    idempotencyConfig(idempotencyKey),
  );
}

function appendCleanFields(formData, fields = {}) {
  Object.entries(cleanParams(fields)).forEach(([key, value]) => {
    formData.append(key, String(value));
  });
  return formData;
}

function imageAnalysisForm({ image, context } = {}) {
  const formData = new FormData();
  if (image) formData.append("image", image);
  return appendCleanFields(formData, { context });
}

function imageRecommendationForm({ image, context, ...payload } = {}) {
  const formData = imageAnalysisForm({ image, context });
  return appendCleanFields(formData, {
    store_id: DEFAULT_STORE_ID || undefined,
    include_preorder: true,
    top_k: 8,
    ...payload,
  });
}

export function analyzeImage({ image, context } = {}) {
  return postForm("/api/image-analysis", imageAnalysisForm({ image, context }));
}

export function getImageRecommendations(payload = {}) {
  return postForm("/api/recommendations/image", imageRecommendationForm(payload));
}

export default apiClient;
