import { datadogLogs } from "@datadog/browser-logs";
import { datadogRum } from "@datadog/browser-rum";
import { reactPlugin } from "@datadog/browser-rum-react";

let initialized = false;
let enabled = false;

const STERLING_HOLLIS_API_ORIGIN = "https://sterling-hollis-be.quickstark.com";

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
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
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

export function initDatadog() {
  if (initialized) return;

  const applicationId = import.meta.env.VITE_DATADOG_APPLICATION_ID;
  const clientToken = import.meta.env.VITE_DATADOG_CLIENT_TOKEN;
  const site = import.meta.env.VITE_DATADOG_SITE || "datadoghq.com";
  const service = import.meta.env.VITE_DATADOG_SERVICE || "sterling-hollis-fe";
  const env = import.meta.env.VITE_ENVIRONMENT || "development";
  const version = import.meta.env.VITE_RELEASE || "local";

  if (!applicationId || !clientToken) {
    initialized = true;
    return;
  }

  datadogRum.init({
    applicationId,
    clientToken,
    site,
    service,
    env,
    version,
    sessionSampleRate: 100,
    sessionReplaySampleRate: 20,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
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
    forwardErrorsToLogs: true,
    sessionSampleRate: 100,
  });

  datadogRum.setGlobalContextProperty("storefront", "sterling-hollis");
  datadogLogs.logger.info("Sterling Hollis storefront initialized");
  enabled = true;
  initialized = true;
}

export function setDatadogUser(user) {
  if (!enabled || !user?.id) return;

  try {
    datadogRum.setUser(user);
    datadogLogs.setUser(user);
  } catch {
    // Optional monitoring should never affect the storefront.
  }
}

export function clearDatadogUser() {
  if (!enabled) return;

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
