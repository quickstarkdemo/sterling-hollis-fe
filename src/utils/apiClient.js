import axios from "axios";

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

async function postForm(path, formData) {
  const response = await uploadClient.post(path, formData);
  return response.data;
}

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

export function getProduct(productId, params) {
  return get(`/api/products/${encodeURIComponent(productId)}`, params);
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

const idempotencyConfig = (idempotencyKey) => ({
  headers: { "Idempotency-Key": idempotencyKey },
});

export function createIdempotencyKey(scope = "catalog") {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${scope}-${randomPart}`;
}

export function getAdminCatalogProducts(params = {}) {
  return get("/api/admin/catalog/products", params);
}

export function getAdminCatalogProduct(productId) {
  return get(catalogProductPath(productId));
}

export function startAdminCatalogProductRevision(productId, payload, idempotencyKey) {
  return post(catalogProductPath(productId, "/revisions"), payload, idempotencyConfig(idempotencyKey));
}

export function saveAdminCatalogProductDraft(productId, payload, idempotencyKey) {
  return put(catalogProductPath(productId, "/draft"), payload, idempotencyConfig(idempotencyKey));
}

export function publishAdminCatalogProduct(productId, payload, idempotencyKey) {
  return post(catalogProductPath(productId, "/publish"), payload, idempotencyConfig(idempotencyKey));
}

export function archiveAdminCatalogProduct(productId, payload, idempotencyKey) {
  return post(catalogProductPath(productId, "/archive"), payload, idempotencyConfig(idempotencyKey));
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

export function createCatalogRealtimeSession(workflowId) {
  return post(catalogWorkflowPath(workflowId, "/realtime/sessions"));
}

export function submitCatalogRealtimeToolCall(workflowId, payload, idempotencyKey) {
  return post(
    catalogWorkflowPath(workflowId, "/realtime/tool-calls"),
    payload,
    idempotencyConfig(idempotencyKey),
  );
}

export function submitCatalogImageCommand(workflowId, payload, idempotencyKey) {
  return post(catalogWorkflowPath(workflowId, "/image-commands"), payload, idempotencyConfig(idempotencyKey));
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
