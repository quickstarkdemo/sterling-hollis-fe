import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  configureApiTraceRuntime,
  createSpanId,
  createTraceId,
  formatTraceparent,
  installAxiosTraceInterceptors,
  isValidSpanId,
  isValidTraceId,
  recordApiTraceEvent,
  resetApiTraceRuntimeForTests,
  runWithApiTrace,
  setApiTraceEventTransport,
  startApiTraceAction,
  subscribeApiTraceEvents,
  traceApiFetch,
} from "./apiTraceClient";

function fakeAxiosClient() {
  const handlers = { request: null, response: null, error: null };
  return {
    handlers,
    interceptors: {
      request: {
        use: vi.fn((handler) => {
          handlers.request = handler;
          return 1;
        }),
      },
      response: {
        use: vi.fn((response, error) => {
          handlers.response = response;
          handlers.error = error;
          return 2;
        }),
      },
    },
  };
}

function enableRuntime() {
  configureApiTraceRuntime({
    authorized: true,
    enabled: true,
    surface: "catalog-studio",
  });
}

describe("apiTraceClient", () => {
  beforeEach(() => {
    resetApiTraceRuntimeForTests();
    setApiTraceEventTransport(null);
  });

  it("creates valid non-zero W3C trace and span identifiers", () => {
    const traceId = createTraceId();
    const spanId = createSpanId();

    expect(isValidTraceId(traceId)).toBe(true);
    expect(isValidSpanId(spanId)).toBe(true);
    expect(formatTraceparent(traceId, spanId)).toBe(`00-${traceId}-${spanId}-01`);
    expect(() => formatTraceparent("0".repeat(32), spanId)).toThrow("invalid_trace_context");
    expect(() => formatTraceparent(traceId, spanId, "bad-flags")).toThrow("invalid_trace_context");
  });

  it("fails open without a secure browser random source", () => {
    enableRuntime();
    vi.stubGlobal("crypto", {});
    try {
      expect(startApiTraceAction("Unsupported browser").enabled).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates concurrent Axios child spans and closes each independently", async () => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    const action = startApiTraceAction("Generate draft");
    const client = fakeAxiosClient();
    installAxiosTraceInterceptors(client);

    const first = client.handlers.request({
      method: "post",
      url: "/api/admin/catalog/workflows/one/draft-commands?secret=no",
      headers: { Authorization: "Bearer clerk-secret" },
    });
    const second = client.handlers.request({
      method: "get",
      url: "/api/admin/catalog/workflows/one",
      headers: {},
    });

    expect(first.headers.Authorization).toBe("Bearer clerk-secret");
    expect(first.headers.traceparent).toMatch(
      new RegExp(`^00-${action.traceId}-[0-9a-f]{16}-01$`),
    );
    expect(first.headers["X-Trace-Surface"]).toBe("catalog-studio");
    expect(second.__apiTrace.span.spanId).not.toBe(first.__apiTrace.span.spanId);
    expect(events[1].parent_span_id).toBe(action.rootSpanId);
    expect(events[2].parent_span_id).toBe(action.rootSpanId);

    client.handlers.response({ config: second, status: 200, headers: {} });
    client.handlers.response({ config: first, status: 201, headers: {} });
    action.end();

    expect(events.map((event) => event.event_type)).toEqual([
      "ui.started",
      "http.started",
      "http.started",
      "http.completed",
      "http.completed",
      "ui.completed",
    ]);
    expect(JSON.stringify(events)).toContain("clerk-secret");
    expect(events[1].attributes.endpoint).toContain("secret=no");
    expect(events[1].attributes.request_headers.Authorization).toBe("Bearer clerk-secret");
  });

  it("closes the root only after outstanding child spans settle", () => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    const action = startApiTraceAction("Deferred completion");
    const span = action.startSpan({ name: "Pending request" });

    action.end();
    expect(events.some((event) => event.event_type === "ui.completed")).toBe(false);
    span.end();

    expect(events.at(-1).event_type).toBe("ui.completed");
  });

  it.each([
    ["ERR_CANCELED", "cancelled"],
    ["ECONNABORTED", "failed"],
    ["ERR_NETWORK", "failed"],
  ])("closes Axios %s failures without changing rejection behavior", async (code, status) => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    startApiTraceAction("Save product");
    const client = fakeAxiosClient();
    installAxiosTraceInterceptors(client);
    const config = client.handlers.request({
      method: "put",
      url: "/api/admin/catalog/products/one/draft",
      headers: {},
      timeout: 1234,
    });
    const error = Object.assign(new Error("private network detail"), { code, config });

    await expect(client.handlers.error(error)).rejects.toBe(error);

    const failed = events.at(-1);
    expect(failed.event_type).toBe("http.failed");
    expect(failed.status).toBe(status);
    expect(JSON.stringify(failed)).not.toContain("private network detail");
    if (code === "ECONNABORTED") expect(failed.attributes.timeout_ms).toBe(1234);
  });

  it("preserves caller trace and authorization headers without duplicate instrumentation", () => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    startApiTraceAction("Existing trace");
    const client = fakeAxiosClient();
    installAxiosTraceInterceptors(client);
    const existing = `00-${"1".repeat(32)}-${"2".repeat(16)}-01`;

    const config = client.handlers.request({
      method: "get",
      url: "/api/products",
      headers: { Authorization: "Bearer token", traceparent: existing },
    });

    expect(config.headers.traceparent).toBe(existing);
    expect(config.headers.Authorization).toBe("Bearer token");
    expect(config.__apiTrace).toBeUndefined();
    expect(events).toHaveLength(1);
  });

  it("marks upload spans while retaining FormData content", () => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    startApiTraceAction("Upload supplier assets");
    const client = fakeAxiosClient();
    installAxiosTraceInterceptors(client, { requestKind: "upload" });
    const formData = new FormData();
    formData.append("private_supplier_filename", "secret-name.jpg");

    client.handlers.request({
      method: "post",
      url: "/api/admin/catalog/source-bundles",
      headers: {},
      data: formData,
    });

    expect(events.at(-1).attributes.request_kind).toBe("upload");
    expect(JSON.stringify(events)).toContain("secret-name.jpg");
    expect(events.at(-1).attributes.request_body.private_supplier_filename).toBe("secret-name.jpg");
  });

  it("does not recursively trace the client-event transport", () => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    startApiTraceAction("Trace transport");
    const client = fakeAxiosClient();
    installAxiosTraceInterceptors(client);

    const config = client.handlers.request({
      apiTrace: false,
      method: "post",
      url: "/api/admin/traces/trace_one/events",
      headers: {},
    });

    expect(config.headers.traceparent).toBeUndefined();
    expect(config.__apiTrace).toBeUndefined();
    expect(events.map((event) => event.event_type)).toEqual(["ui.started"]);
  });

  it("flushes allowlisted events only after the backend accepts the trace", async () => {
    enableRuntime();
    const transport = vi.fn().mockResolvedValue(undefined);
    setApiTraceEventTransport(transport);
    const action = startApiTraceAction("Accepted trace", {
      attributes: { workflow_id: "workflow_1", authorization: "Bearer secret" },
    });
    const client = fakeAxiosClient();
    installAxiosTraceInterceptors(client);
    const config = client.handlers.request({ method: "post", url: "/api/action", headers: {} });

    expect(transport).not.toHaveBeenCalled();
    client.handlers.response({
      config,
      status: 200,
      headers: { "x-trace-capture": "active", "x-trace-id": action.traceId },
    });
    action.end();
    await action.transportChain;

    expect(transport).toHaveBeenCalledTimes(4);
    const encoded = JSON.stringify(transport.mock.calls);
    expect(encoded).toContain("Bearer secret");
    expect(encoded).toContain("authorization");
    expect(transport.mock.calls[0][0]).toBe(action.traceId);
  });

  it("keeps disabled and unauthorized traffic behavior unchanged", async () => {
    const transport = vi.fn();
    setApiTraceEventTransport(transport);
    configureApiTraceRuntime({ authorized: true, enabled: false });
    const action = startApiTraceAction("Disabled");
    const client = fakeAxiosClient();
    installAxiosTraceInterceptors(client);
    const config = client.handlers.request({ method: "get", url: "/api/products", headers: {} });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: {} });

    await traceApiFetch("/api/products", { method: "GET" }, { fetchImpl, propagate: true });

    expect(action.enabled).toBe(false);
    expect(config.headers.traceparent).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/api/products", { method: "GET" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("traces explicit fetch with provider credentials, body, and query values for the dev tray", async () => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    startApiTraceAction("Realtime voice");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ "x-response-id": "resp_1" }),
      body: {},
      clone: () => ({ text: vi.fn().mockResolvedValue("provider response body") }),
    });

    await traceApiFetch(
      "https://api.openai.com/v1/realtime/calls?token=private",
      {
        method: "POST",
        headers: { Authorization: "Bearer ephemeral-secret", "Content-Type": "application/sdp" },
        body: "private-sdp-body",
      },
      { fetchImpl, operation: "realtime.sdp", propagate: false, transport: "webrtc" },
    );

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer ephemeral-secret");
    const encoded = JSON.stringify(events);
    expect(encoded).toContain("ephemeral-secret");
    expect(encoded).toContain("private-sdp-body");
    expect(encoded).toContain("token=private");
    expect(encoded).toContain("provider response body");
    expect(encoded).toContain("x-response-id");
    expect(events.at(-1).attributes.status_code).toBe(201);
  });

  it("propagates explicit fetch context only when requested", async () => {
    enableRuntime();
    const action = startApiTraceAction("Explicit fetch");
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: {} });

    await traceApiFetch(
      "/api/admin/catalog/workflows/one",
      { headers: { Authorization: "Bearer token" } },
      { fetchImpl, propagate: true },
    );

    const headers = fetchImpl.mock.calls[0][1].headers;
    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(headers.get("traceparent")).toMatch(
      new RegExp(`^00-${action.traceId}-[0-9a-f]{16}-01$`),
    );
  });

  it("records full Realtime lifecycle attributes", () => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    const action = startApiTraceAction("Voice");

    recordApiTraceEvent(
      "realtime.connected",
      {
        transport: "webrtc",
        raw_audio: "private-audio",
        transcript: "private transcript",
        client_secret: "ephemeral-secret",
      },
      { action, status: "connected" },
    );

    expect(events.at(-1).attributes).toEqual({
      transport: "webrtc",
      raw_audio: "private-audio",
      transcript: "private transcript",
      client_secret: "ephemeral-secret",
    });
  });

  it("allowlists visible conversation turns for backend event transport", async () => {
    enableRuntime();
    const transport = vi.fn().mockResolvedValue(undefined);
    setApiTraceEventTransport(transport);
    const action = startApiTraceAction("Voice transcript");

    recordApiTraceEvent(
      "conversation.turn",
      {
        route: "catalog_realtime_voice",
        visible_messages: [
          {
            visible_role: "assistant",
            visible_text: "Dallas is low on stock.",
            visible_source: "realtime_transcript",
          },
        ],
      },
      { action, status: "recorded" },
    );
    action.accept({ "x-trace-capture": "active", "x-trace-id": action.traceId });
    await action.transportChain;

    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][1]).toEqual(expect.objectContaining({
      event_type: "conversation.turn",
      attributes: expect.objectContaining({
        visible_messages: [expect.objectContaining({
          visible_role: "assistant",
          visible_text: "Dallas is low on stock.",
        })],
      }),
    }));
  });

  it("preserves recognizable secrets, customer identifiers, and query values in trace display text", () => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    const action = startApiTraceAction(
      "Email shopper@example.com with Bearer private-token",
    );
    const client = fakeAxiosClient();
    installAxiosTraceInterceptors(client);
    const config = client.handlers.request({
      method: "get",
      url: "/api/customers/shopper@example.com?token=private",
      headers: {},
    });
    client.handlers.response({ config, status: 200, headers: {} });
    action.end();

    const encoded = JSON.stringify(events);
    expect(encoded).toContain("shopper@example.com");
    expect(encoded).toContain("private-token");
    expect(encoded).toContain("token=private");
  });

  it("finishes traced actions while preserving callback results and errors", async () => {
    enableRuntime();
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));

    await expect(runWithApiTrace("Success", async () => "saved")).resolves.toBe("saved");
    const failure = Object.assign(new Error("private detail"), { code: "ERR_FAILED" });
    await expect(runWithApiTrace("Failure", async () => { throw failure; })).rejects.toBe(failure);

    expect(events.filter((event) => event.event_type === "ui.completed")).toHaveLength(1);
    expect(events.filter((event) => event.event_type === "ui.failed")).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("private detail");
  });
});
