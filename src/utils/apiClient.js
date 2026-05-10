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
  return get("/admin/demo/observability");
}

export function updateDemoObservabilityState(payload = {}) {
  return post("/admin/demo/observability", payload);
}

export function resetDemoObservabilityState() {
  return post("/admin/demo/observability/reset");
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
