import { datadogLogs } from "@datadog/browser-logs";
import { datadogRum } from "@datadog/browser-rum";
import { reactPlugin } from "@datadog/browser-rum-react";

import { isApiTracePropagationActive } from "./apiTraceClient";

const STERLING_HOLLIS_API_ORIGIN = "https://sterling-hollis-be.quickstark.com";
const DATADOG_STATE_KEY = "__STERLING_HOLLIS_DATADOG__";
const datadogState = (globalThis[DATADOG_STATE_KEY] ||= {
  authContext: null,
  enabled: false,
  initialized: false,
  pendingUser: null,
});

function normalizeOrigin(value) {
  if (!value) return "";

  try {
    return new URL(value, window.location.origin).origin;
  } catch {
    return "";
  }
}

function isLocalDevelopmentUrl(value) {
  try {
    const { hostname } = new URL(value);
    return isLocalHostname(hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isLocalDatadogEnabled() {
  return import.meta.env.VITE_DATADOG_ENABLE_LOCAL === "true";
}

function uniqueTruthy(values) {
  return [...new Set(values.filter(Boolean))];
}

function toTracingPrefix(origin) {
  return origin ? `${origin}/` : "";
}

export function getAllowedTracingUrls() {
  const apiUrl = normalizeOrigin(import.meta.env.VITE_API_URL);
  const apiProxyTarget = normalizeOrigin(import.meta.env.VITE_API_PROXY_TARGET);
  const browserOrigin = normalizeOrigin(window.location.origin);

  const matches = [
    ...uniqueTruthy([STERLING_HOLLIS_API_ORIGIN, apiProxyTarget, apiUrl, browserOrigin]).map(toTracingPrefix),
    isLocalDevelopmentUrl,
  ];
  return matches.map((match) => ({
    match: (url) => !isApiTracePropagationActive()
      && (typeof match === "function" ? match(url) : String(url).startsWith(match)),
    // W3C preserves Datadog distributed tracing while avoiding x-datadog CORS
    // headers. During an app trace, the app runtime owns this header exclusively.
    propagatorTypes: ["tracecontext"],
  }));
}

function getSampleRate(value, fallback) {
  const sampleRate = Number(value);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 100) return fallback;
  return sampleRate;
}

function applyPendingUser() {
  if (datadogState.pendingUser) setDatadogUser(datadogState.pendingUser);
  if (datadogState.authContext) setDatadogAuthContext(datadogState.authContext);
}

function setContextProperty(name, value) {
  datadogRum.setGlobalContextProperty(name, value);
  datadogLogs.setGlobalContextProperty(name, value);
}

export function initDatadog() {
  if (datadogState.initialized) return;

  const applicationId = import.meta.env.VITE_DATADOG_APPLICATION_ID;
  const clientToken = import.meta.env.VITE_DATADOG_CLIENT_TOKEN;
  const site = import.meta.env.VITE_DATADOG_SITE || "datadoghq.com";
  const service = import.meta.env.VITE_DATADOG_SERVICE || "sterling-hollis-fe";
  const env = import.meta.env.VITE_ENVIRONMENT || "development";
  const version = import.meta.env.VITE_RELEASE || "local";
  const sessionSampleRate = getSampleRate(import.meta.env.VITE_DATADOG_SESSION_SAMPLE_RATE, 100);
  const sessionReplaySampleRate = getSampleRate(import.meta.env.VITE_DATADOG_REPLAY_SAMPLE_RATE, 100);

  if (!applicationId || !clientToken || (isLocalHostname(window.location.hostname) && !isLocalDatadogEnabled())) {
    datadogState.initialized = true;
    return;
  }

  datadogRum.init({
    applicationId,
    clientToken,
    site,
    service,
    env,
    version,
    sessionSampleRate,
    sessionReplaySampleRate,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    silentMultipleInit: true,
    defaultPrivacyLevel: "mask-user-input",
    allowedTracingUrls: getAllowedTracingUrls(),
    plugins: [reactPlugin({ router: true })],
  });

  datadogLogs.init({
    clientToken,
    site,
    service,
    env,
    version,
    silentMultipleInit: true,
    forwardErrorsToLogs: true,
    sessionSampleRate,
  });

  datadogRum.setGlobalContextProperty("storefront", "sterling-hollis");
  datadogLogs.logger.info("Sterling Hollis storefront initialized");
  if (sessionReplaySampleRate > 0) datadogRum.startSessionReplayRecording({ force: true });
  datadogState.enabled = true;
  datadogState.initialized = true;
  applyPendingUser();
}

export function setDatadogUser(user) {
  if (!user?.id) return;
  datadogState.pendingUser = user;
  if (!datadogState.enabled) return;

  try {
    datadogRum.setUser(user);
    datadogLogs.setUser(user);
  } catch {
    // Optional monitoring should never affect the storefront.
  }
}

export function setDatadogAuthContext(authContext) {
  datadogState.authContext = authContext;
  if (!datadogState.enabled) return;

  try {
    setContextProperty("auth", authContext);
    setContextProperty("auth_provider", authContext.provider);
    setContextProperty("auth_status", authContext.status);
  } catch {
    // Optional monitoring should never affect the storefront.
  }
}

export function clearDatadogAuthContext() {
  datadogState.authContext = null;
  if (!datadogState.enabled) return;

  try {
    setContextProperty("auth", { provider: "clerk", status: "anonymous" });
    setContextProperty("auth_provider", "clerk");
    setContextProperty("auth_status", "anonymous");
  } catch {
    // Optional monitoring should never affect the storefront.
  }
}

export function clearDatadogUser() {
  datadogState.pendingUser = null;
  if (!datadogState.enabled) return;

  try {
    datadogRum.clearUser();
    datadogLogs.clearUser();
  } catch {
    // Optional monitoring should never affect the storefront.
  }
}

export function trackAction(name, context = {}) {
  try {
    datadogRum.addAction(name, context);
  } catch {
    // Optional monitoring should never affect the demo.
  }
}

const CATALOG_STUDIO_MILESTONES = new Set([
  "workflow_started",
  "draft_command_finished",
  "image_job_started",
  "image_job_finished",
  "image_approved",
  "voice_command_finished",
  "product_published",
  "recovery_presented",
]);

const CATALOG_STUDIO_CONTEXT_KEYS = new Set([
  "action",
  "capability",
  "product_id",
  "retryable",
  "source",
  "status",
  "workflow_id",
]);

export function trackCatalogStudioMilestone(milestone, context = {}) {
  if (!CATALOG_STUDIO_MILESTONES.has(milestone)) return;

  const safeContext = Object.fromEntries(
    Object.entries(context).flatMap(([key, value]) => {
      if (!CATALOG_STUDIO_CONTEXT_KEYS.has(key)) return [];
      if (typeof value === "string") return [[key, value.slice(0, 200)]];
      if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return [[key, value]];
      return [];
    }),
  );
  trackAction("catalog_studio.milestone", { milestone, ...safeContext });
}
