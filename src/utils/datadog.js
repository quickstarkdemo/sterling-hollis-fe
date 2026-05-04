import { datadogLogs } from "@datadog/browser-logs";
import { datadogRum } from "@datadog/browser-rum";
import { reactPlugin } from "@datadog/browser-rum-react";

const STERLING_HOLLIS_API_ORIGIN = "https://sterling-hollis-be.quickstark.com";
const DATADOG_STATE_KEY = "__STERLING_HOLLIS_DATADOG__";
const datadogState = (globalThis[DATADOG_STATE_KEY] ||= {
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

function getAllowedTracingUrls() {
  const apiUrl = normalizeOrigin(import.meta.env.VITE_API_URL);
  const apiProxyTarget = normalizeOrigin(import.meta.env.VITE_API_PROXY_TARGET);
  const browserOrigin = normalizeOrigin(window.location.origin);

  return [
    ...uniqueTruthy([STERLING_HOLLIS_API_ORIGIN, apiProxyTarget, apiUrl, browserOrigin]).map(toTracingPrefix),
    isLocalDevelopmentUrl,
  ];
}

function getSampleRate(value, fallback) {
  const sampleRate = Number(value);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 100) return fallback;
  return sampleRate;
}

function applyPendingUser() {
  if (datadogState.pendingUser) setDatadogUser(datadogState.pendingUser);
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
    storeContextsAcrossPages: true,
    trackSessionAcrossSubdomains: true,
    silentMultipleInit: true,
    defaultPrivacyLevel: "mask-user-input",
    allowedTracingUrls: getAllowedTracingUrls(),
    plugins: [reactPlugin({ router: false })],
  });

  datadogLogs.init({
    clientToken,
    site,
    service,
    env,
    version,
    storeContextsAcrossPages: true,
    trackSessionAcrossSubdomains: true,
    silentMultipleInit: true,
    forwardErrorsToLogs: true,
    sessionSampleRate,
  });

  datadogRum.setGlobalContextProperty("storefront", "sterling-hollis");
  datadogLogs.logger.info("Sterling Hollis storefront initialized");
  if (sessionReplaySampleRate > 0) datadogRum.startSessionReplayRecording();
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
