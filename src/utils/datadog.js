import { datadogLogs } from "@datadog/browser-logs";
import { datadogRum } from "@datadog/browser-rum";

let initialized = false;

export function initDatadog() {
  if (initialized) return;

  const applicationId = import.meta.env.VITE_DATADOG_APPLICATION_ID;
  const clientToken = import.meta.env.VITE_DATADOG_CLIENT_TOKEN;
  const site = import.meta.env.VITE_DATADOG_SITE || "datadoghq.com";
  const service = import.meta.env.VITE_DATADOG_SERVICE || "sterling-hollis-fe";
  const env = import.meta.env.VITE_ENVIRONMENT || "development";
  const version = import.meta.env.VITE_RELEASE || "local";
  const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;

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
    allowedTracingUrls: [apiUrl, (url) => url.startsWith("http://localhost")],
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
  initialized = true;
}

export function trackAction(name, context = {}) {
  try {
    datadogRum.addAction(name, context);
  } catch {
    // Optional monitoring should never affect the demo.
  }
}
