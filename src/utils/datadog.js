import { datadogLogs } from "@datadog/browser-logs";
import { datadogRum } from "@datadog/browser-rum";
import { reactPlugin } from "@datadog/browser-rum-react";

const STERLING_HOLLIS_API_ORIGIN = "https://sterling-hollis-be.quickstark.com";
const DATADOG_STATE_KEY = "__STERLING_HOLLIS_DATADOG__";
const DEFAULT_NETWORK_OUTAGE_TRAP_LOG = {
  message:
    "SNMP Trap: DATACENTER-USER-SW11A linkDown - uplink interface Gi1/0/48 unreachable, packet loss 100%, affected services: sterling-hollis-be",
  ddsource: "snmp-traps",
  service: "network-device-monitoring",
  hostname: "datacenter-user-sw11a",
  status: "critical",
  device_name: "DATACENTER-USER-SW11A",
  device_role: "access_switch",
  device_vendor: "cisco",
  trap_name: "linkDown",
  trap_oid: "1.3.6.1.6.3.1.1.5.3",
  interface: "Gi1/0/48",
  site: "dc01",
  namespace: "dc01",
  incident_id: "demo-network-outage-2026-05-08",
  correlation_key: "sterling-hollis-network-outage",
  affected_service: "sterling-hollis-be",
  outage_scope: "storefront_api",
  ddtags:
    "env:production,source:snmp-traps,category:network,event_type:trigger,severity:critical,device:datacenter-user-sw11a,site:dc01,service:sterling-hollis-be,incident_id:demo-network-outage-2026-05-08,correlation_key:sterling-hollis-network-outage",
};
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

export function emitNetworkOutageTrapLog(payload = {}) {
  if (!datadogState.enabled) return;

  const logPayload = {
    ...DEFAULT_NETWORK_OUTAGE_TRAP_LOG,
    ...payload,
  };

  try {
    datadogLogs.logger.error(logPayload.message, logPayload);
  } catch {
    // Optional monitoring should never affect the demo.
  }
}
