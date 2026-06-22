const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
const MAX_PENDING_EVENTS = 100;

const CLIENT_EVENT_TYPES = new Set([
  "ui.started",
  "ui.completed",
  "ui.failed",
  "http.started",
  "http.completed",
  "http.failed",
  "realtime.connected",
  "realtime.disconnected",
  "realtime.error",
]);

const subscribers = new Set();
let activeAction = null;
let eventTransport = null;
let runtime = {
  authorized: false,
  enabled: false,
  surface: "developer",
};

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  if (!globalThis.crypto?.getRandomValues) throw new Error("secure_random_unavailable");
  globalThis.crypto.getRandomValues(bytes);
  if (bytes.every((value) => value === 0)) bytes[bytes.length - 1] = 1;
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function createTraceId() {
  return randomHex(16);
}

export function createSpanId() {
  return randomHex(8);
}

export function isValidTraceId(value) {
  return TRACE_ID_PATTERN.test(value) && value !== ZERO_TRACE_ID;
}

export function isValidSpanId(value) {
  return SPAN_ID_PATTERN.test(value) && value !== ZERO_SPAN_ID;
}

export function formatTraceparent(traceId, spanId, flags = "01") {
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId) || !/^[0-9a-f]{2}$/.test(flags)) {
    throw new Error("invalid_trace_context");
  }
  return `00-${traceId}-${spanId}-${flags}`;
}

function safeText(value) {
  return String(value ?? "").replace(/[\r\n]/g, " ");
}

function safeSurface(value) {
  const normalized = String(value || "developer").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)
    ? normalized
    : "developer";
}

function traceValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return null;
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (typeof Headers !== "undefined" && value instanceof Headers) return Object.fromEntries(value.entries());
  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) return Object.fromEntries(value.entries());
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return Object.fromEntries([...value.entries()].map(([key, item]) => [key, traceValue(item, seen)]));
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return {
      name: value.name || null,
      size: value.size,
      type: value.type,
    };
  }
  if (value instanceof ArrayBuffer) return { byte_length: value.byteLength, type: "ArrayBuffer" };
  if (ArrayBuffer.isView(value)) return { byte_length: value.byteLength, type: value.constructor?.name || "TypedArray" };
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => traceValue(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, traceValue(item, seen)]));
}

function sanitizeAttributes(attributes = {}) {
  return traceValue(attributes) || {};
}

function endpointFor(input) {
  const value = typeof input === "string" ? input : input?.url || "";
  try {
    const base = globalThis.location?.origin || "http://localhost";
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}` : url.href;
  } catch {
    return safeText(value);
  }
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1] || "";
}

function setHeader(config, name, value) {
  const headers = config.headers || {};
  if (typeof headers.set === "function") {
    headers.set(name, value);
    config.headers = headers;
    return;
  }
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  config.headers = { ...headers, [existingKey || name]: value };
}

function notify(event) {
  subscribers.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Trace observers must never affect application behavior.
    }
  });
}

function transportEvent(action, event) {
  if (!eventTransport || !action.accepted || !runtime.enabled || !runtime.authorized) return;
  const payload = {
    event_id: event.event_id,
    span_id: event.span_id,
    name: event.name,
    event_type: event.event_type,
    status: event.status,
    occurred_at: event.occurred_at,
    attributes: event.attributes,
  };
  action.transportChain = action.transportChain
    .then(() => eventTransport(action.traceId, payload))
    .catch(() => undefined);
}

function publish(action, eventType, details = {}) {
  if (!action?.enabled || !CLIENT_EVENT_TYPES.has(eventType)) return null;
  action.sequence += 1;
  const event = {
    trace_id: action.traceId,
    span_id: details.spanId || action.rootSpanId,
    parent_span_id: details.parentSpanId || null,
    local_sequence: action.sequence,
    event_id: `evt_${randomHex(16)}`,
    name: safeText(details.name || eventType),
    event_type: eventType,
    status: safeText(details.status || "") || null,
    occurred_at: new Date().toISOString(),
    attributes: sanitizeAttributes(details.attributes),
  };
  notify(event);
  if (action.accepted) {
    transportEvent(action, event);
  } else if (action.pendingEvents.length < MAX_PENDING_EVENTS) {
    action.pendingEvents.push(event);
  }
  return event;
}

function acceptAction(action, responseHeaders) {
  const capture = safeText(headerValue(responseHeaders, "x-trace-capture")).toLowerCase();
  const returnedTraceId = safeText(headerValue(responseHeaders, "x-trace-id")).toLowerCase();
  if (capture !== "active" || (returnedTraceId && returnedTraceId !== action.traceId)) return;
  action.accepted = true;
  const pending = action.pendingEvents.splice(0);
  pending.forEach((event) => transportEvent(action, event));
}

function createDisabledAction() {
  const noOpSpan = { enabled: false, end: () => {} };
  return {
    enabled: false,
    traceId: null,
    rootSpanId: null,
    startSpan: () => noOpSpan,
    record: () => null,
    end: () => {},
  };
}

export function configureApiTraceRuntime({ enabled, authorized, surface } = {}) {
  runtime = {
    enabled: Boolean(enabled),
    authorized: Boolean(authorized),
    surface: safeSurface(surface),
  };
  if (!runtime.enabled || !runtime.authorized) activeAction = null;
  return { ...runtime };
}

export function setApiTraceEventTransport(transport) {
  eventTransport = typeof transport === "function" ? transport : null;
}

export function subscribeApiTraceEvents(listener) {
  if (typeof listener !== "function") return () => {};
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function isApiTracePropagationActive() {
  return Boolean(
    runtime.enabled
      && runtime.authorized
      && activeAction?.enabled
      && !activeAction.ended
      && !activeAction.ending,
  );
}

export function startApiTraceAction(name, options = {}) {
  if (!runtime.enabled || !runtime.authorized) return createDisabledAction();
  const previousAction = activeAction;
  let traceId;
  let rootSpanId;
  try {
    traceId = createTraceId();
    rootSpanId = createSpanId();
  } catch {
    return createDisabledAction();
  }
  const action = {
    enabled: true,
    accepted: false,
    ended: false,
    ending: false,
    name: safeText(name || "Browser action"),
    surface: safeSurface(options.surface || runtime.surface),
    traceId,
    rootSpanId,
    pendingEvents: [],
    activeSpanCount: 0,
    sequence: -1,
    transportChain: Promise.resolve(),
  };

  const finishAction = (status, attributes) => {
    if (action.ended) return;
    action.ended = true;
    publish(action, status === "completed" ? "ui.completed" : "ui.failed", {
      spanId: action.rootSpanId,
      name: action.name,
      status,
      attributes: { ...attributes, operation: "ui.action", surface: action.surface },
    });
  };

  action.startSpan = ({ name: spanName, operation = "http.client", attributes = {} } = {}) => {
    if (action.ended || action.ending) return createDisabledAction().startSpan();
    const spanId = createSpanId();
    let ended = false;
    action.activeSpanCount += 1;
    publish(action, "http.started", {
      spanId,
      parentSpanId: action.rootSpanId,
      name: spanName || operation,
      status: "running",
      attributes: { ...attributes, operation },
    });
    return {
      enabled: true,
      traceId: action.traceId,
      spanId,
      parentSpanId: action.rootSpanId,
      end(status = "completed", details = {}) {
        if (ended) return;
        ended = true;
        publish(action, status === "completed" ? "http.completed" : "http.failed", {
          spanId,
          parentSpanId: action.rootSpanId,
          name: spanName || operation,
          status,
          attributes: { ...attributes, ...details.attributes, operation },
        });
        action.activeSpanCount -= 1;
        if (action.activeSpanCount === 0 && action.pendingEnd) {
          finishAction(action.pendingEnd.status, action.pendingEnd.attributes);
        }
      },
    };
  };

  action.record = (eventType, details = {}) => publish(action, eventType, details);
  action.accept = (headers) => acceptAction(action, headers);
  action.end = (status = "completed", attributes = {}) => {
    if (action.ended || action.ending) return;
    action.ending = true;
    if (activeAction === action) {
      activeAction = previousAction?.ended || previousAction?.ending ? null : previousAction;
    }
    if (action.activeSpanCount > 0) {
      action.pendingEnd = { status, attributes };
      return;
    }
    finishAction(status, attributes);
  };

  activeAction = action;
  publish(action, "ui.started", {
    spanId: action.rootSpanId,
    name: action.name,
    status: "running",
    attributes: { ...options.attributes, operation: "ui.action", surface: action.surface },
  });
  return action;
}

export async function runWithApiTrace(name, callback, options = {}) {
  const action = startApiTraceAction(name, options);
  try {
    const result = await callback(action);
    action.end("completed");
    return result;
  } catch (error) {
    const cancelled = error?.code === "ERR_CANCELED" || error?.name === "AbortError";
    action.end(cancelled ? "cancelled" : "failed", {
      cancelled,
      error_code: safeText(error?.code || error?.name || "error"),
    });
    throw error;
  }
}

function actionForConfig(config = {}) {
  return config.apiTraceAction?.enabled ? config.apiTraceAction : activeAction;
}

function beginAxiosTrace(config, requestKind) {
  if (config.apiTrace === false || headerValue(config.headers, "traceparent")) return config;
  const action = actionForConfig(config);
  if (!action?.enabled || action.ended) return config;
  const method = safeText(config.method || "get").toUpperCase();
  const endpoint = endpointFor(config.url || "");
  const span = action.startSpan({
    name: `${method} ${endpoint}`,
    operation: "http.client",
    attributes: {
      endpoint,
      http_method: method,
      request_body: config.data ?? null,
      request_headers: config.headers || {},
      request_kind: requestKind,
      request_params: config.params || null,
      request_url: endpoint,
    },
  });
  setHeader(config, "traceparent", formatTraceparent(action.traceId, span.spanId));
  setHeader(config, "X-Trace-Surface", action.surface);
  config.__apiTrace = { action, span, endpoint, method, requestKind };
  return config;
}

function completeAxiosTrace(value, failed = false) {
  const config = value?.config;
  const metadata = config?.__apiTrace;
  if (!metadata) return;
  const response = failed ? value?.response : value;
  if (response?.headers) metadata.action.accept(response.headers);
  const cancelled = value?.code === "ERR_CANCELED" || value?.name === "CanceledError";
  const timeout = value?.code === "ECONNABORTED" || value?.code === "ETIMEDOUT";
  const statusCode = Number(response?.status);
  const succeeded = !failed && (!Number.isFinite(statusCode) || statusCode < 400);
  metadata.span.end(succeeded ? "completed" : cancelled ? "cancelled" : "failed", {
    attributes: {
      cancelled,
      endpoint: metadata.endpoint,
      error_code: failed ? safeText(timeout ? "timeout" : value?.code || "request_failed") : "",
      http_method: metadata.method,
      request_kind: metadata.requestKind,
      response_body: response?.data ?? null,
      response_headers: response?.headers || {},
      status_code: Number.isFinite(statusCode) ? statusCode : 0,
      timeout_ms: timeout ? Number(config?.timeout || 0) : 0,
    },
  });
}

export function installAxiosTraceInterceptors(client, { requestKind = "http" } = {}) {
  const requestId = client.interceptors.request.use((config) => beginAxiosTrace(config, requestKind));
  const responseId = client.interceptors.response.use(
    (response) => {
      completeAxiosTrace(response);
      return response;
    },
    (error) => {
      completeAxiosTrace(error, true);
      return Promise.reject(error);
    },
  );
  return { requestId, responseId };
}

function fetchHeaders(init) {
  if (typeof Headers === "undefined") return { ...(init.headers || {}) };
  return new Headers(init.headers || {});
}

async function responseBodyForTrace(response) {
  try {
    if (!response?.clone || !response?.body) return null;
    return await response.clone().text();
  } catch {
    return "[UNAVAILABLE_RESPONSE_BODY]";
  }
}

export async function traceApiFetch(input, init = {}, options = {}) {
  const action = options.action?.enabled ? options.action : activeAction;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!action?.enabled || action.ended || typeof fetchImpl !== "function") {
    return fetchImpl(input, init);
  }
  const method = safeText(init.method || "GET").toUpperCase();
  const endpoint = endpointFor(input);
  const span = action.startSpan({
    name: `${method} ${endpoint}`,
    operation: options.operation || "http.client",
    attributes: {
      endpoint,
      http_method: method,
      request_body: init.body ?? null,
      request_headers: init.headers || {},
      request_kind: options.requestKind || "fetch",
      request_url: endpoint,
      transport: options.transport || "fetch",
    },
  });
  const nextInit = { ...init };
  if (options.propagate === true) {
    const headers = fetchHeaders(init);
    if (!headerValue(headers, "traceparent")) {
      if (typeof headers.set === "function") {
        headers.set("traceparent", formatTraceparent(action.traceId, span.spanId));
        headers.set("X-Trace-Surface", action.surface);
      } else {
        headers.traceparent = formatTraceparent(action.traceId, span.spanId);
        headers["X-Trace-Surface"] = action.surface;
      }
    }
    nextInit.headers = headers;
  }

  try {
    const response = await fetchImpl(input, nextInit);
    action.accept(response?.headers);
    const responseBody = await responseBodyForTrace(response);
    span.end(response?.ok === false ? "failed" : "completed", {
      attributes: {
        response_body: responseBody,
        response_headers: response?.headers || {},
        status_code: Number(response?.status || 0),
      },
    });
    return response;
  } catch (error) {
    const cancelled = error?.name === "AbortError";
    span.end(cancelled ? "cancelled" : "failed", {
      attributes: {
        cancelled,
        error_code: safeText(error?.name || "fetch_failed"),
      },
    });
    throw error;
  }
}

export function recordApiTraceEvent(eventType, attributes = {}, options = {}) {
  const action = options.action?.enabled ? options.action : activeAction;
  return publish(action, eventType, {
    spanId: options.spanId || action?.rootSpanId,
    name: options.name || eventType,
    status: options.status || null,
    attributes,
  });
}

export function resetApiTraceRuntimeForTests() {
  runtime = { authorized: false, enabled: false, surface: "developer" };
  activeAction = null;
  eventTransport = null;
  subscribers.clear();
}
