import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import { CatalogStudioAccessContext } from "./CatalogStudioAccessContext";
import { DeveloperLensContext } from "./DeveloperLensContext";
import ApiTraceProvider, {
  ApiTraceCapabilityBridge,
} from "./ApiTraceProvider";
import { useApiTrace } from "./ApiTraceContext";
import {
  resetApiTraceRuntimeForTests,
  startApiTraceAction,
} from "../utils/apiTraceClient";
import {
  getAdminApiTrace,
  getAdminApiTraceEvents,
  getAdminApiTraces,
  subscribeAdminApiTraceEvents,
} from "../utils/apiClient";

vi.mock("../utils/apiClient", () => ({
  getAdminApiTraces: vi.fn().mockResolvedValue({ items: [] }),
  getAdminApiTrace: vi.fn().mockResolvedValue(null),
  getAdminApiTraceEvents: vi.fn().mockResolvedValue({ items: [], next_cursor: -1 }),
  subscribeAdminApiTraceEvents: vi.fn(() => new Promise(() => {})),
}));

function TraceConsumer() {
  const trace = useApiTrace();
  const [events, setEvents] = useState([]);

  useEffect(() => trace.subscribe((event) => {
    setEvents((current) => [...current, event]);
  }), [trace]);

  return (
    <>
      <div>available:{String(trace.available)}</div>
      <div>enabled:{String(trace.enabled)}</div>
      <div>events:{events.length}</div>
      <div>connection:{trace.connectionStatus}</div>
      <div>traceStatus:{trace.traceStatus}</div>
      <div>traceError:{trace.traceError || ""}</div>
      <div>selectedEvents:{trace.selectedTrace?.events?.length || 0}</div>
      <button
        type="button"
        onClick={() => {
          const action = trace.startAction("Provider action");
          action.end();
        }}
      >
        Trace action
      </button>
    </>
  );
}

function renderProvider({ status = "authorized", capability = true, lens = true } = {}) {
  return renderWithProviders(
    <ApiTraceProvider>
      <CatalogStudioAccessContext.Provider
        value={{
          status,
          session: {
            authorized: status === "authorized",
            capabilities: { api_traces: { configured: capability } },
          },
          retry: () => {},
        }}
      >
        <DeveloperLensContext.Provider value={{ enabled: lens }}>
          <ApiTraceCapabilityBridge />
          <TraceConsumer />
        </DeveloperLensContext.Provider>
      </CatalogStudioAccessContext.Provider>
    </ApiTraceProvider>,
  );
}

function mockSelectedTrace(events = []) {
  const trace = {
    trace_id: "trace-1",
    surface: "catalog-studio",
    name: "Trace stream",
    status: "running",
    started_at: "2026-06-30T00:00:00Z",
    duration_ms: null,
    payload_expired: false,
    events,
    spans: [],
    artifacts: [],
  };
  getAdminApiTraces.mockResolvedValue({ items: [trace] });
  getAdminApiTrace.mockResolvedValue(trace);
  return trace;
}

describe("ApiTraceProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiTraceRuntimeForTests();
    getAdminApiTraces.mockResolvedValue({ items: [] });
    getAdminApiTrace.mockResolvedValue(null);
    getAdminApiTraceEvents.mockResolvedValue({ items: [], next_cursor: -1 });
    subscribeAdminApiTraceEvents.mockImplementation(() => new Promise(() => {}));
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enables capture only for an authorized capability with the developer lens on", async () => {
    renderProvider();

    expect(await screen.findByText("available:true")).toBeInTheDocument();
    expect(await screen.findByText("enabled:true")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Trace action" }));

    await waitFor(() => expect(screen.getByText("events:2")).toBeInTheDocument());
  });

  it.each([
    ["anonymous", true, true],
    ["authorized", false, true],
    ["authorized", true, false],
  ])("keeps capture disabled for status=%s capability=%s lens=%s", async (status, capability, lens) => {
    renderProvider({ status, capability, lens });

    expect(await screen.findByText("enabled:false")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Trace action" }));
    expect(screen.getByText("events:0")).toBeInTheDocument();
    expect(getAdminApiTraces).not.toHaveBeenCalled();
    expect(subscribeAdminApiTraceEvents).not.toHaveBeenCalled();
  });

  it("resets the session-scoped runtime when the provider unmounts", async () => {
    const view = renderProvider();
    expect(await screen.findByText("enabled:true")).toBeInTheDocument();

    view.unmount();

    expect(startApiTraceAction("After unmount").enabled).toBe(false);
  });

  it("does not retry expected trace stream aborts from cleanup or navigation", async () => {
    mockSelectedTrace();
    subscribeAdminApiTraceEvents.mockImplementationOnce(async (_traceId, { onStatus }) => {
      onStatus("live");
      return { closeReason: "client_abort", expected: true, lastEventSequence: -1 };
    });

    renderProvider();

    expect(await screen.findByText("connection:live")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(subscribeAdminApiTraceEvents).toHaveBeenCalledTimes(1);
    expect(screen.getByText("traceError:")).toBeInTheDocument();
  });

  it("retries non-abort stream failures from the last seen sequence", async () => {
    mockSelectedTrace([{ event_id: "evt-3", sequence: 3, name: "Existing" }]);
    subscribeAdminApiTraceEvents
      .mockRejectedValueOnce(Object.assign(new Error("network down"), { closeReason: "network_error" }))
      .mockImplementationOnce(async (_traceId, { afterSequence, onStatus, onEvent }) => {
        expect(afterSequence).toBe(3);
        onStatus("live");
        onEvent({
          type: "trace_event",
          data: { event_id: "evt-4", sequence: 4, name: "Recovered" },
        });
        return new Promise(() => {});
      });

    renderProvider();

    await waitFor(() => expect(subscribeAdminApiTraceEvents).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("connection:reconnecting")).toBeInTheDocument();
    expect(screen.getByText("traceError:Trace stream interrupted. Reconnecting.")).toBeInTheDocument();
    await waitFor(() => expect(subscribeAdminApiTraceEvents).toHaveBeenCalledTimes(2), { timeout: 1200 });
    expect(await screen.findByText("connection:live")).toBeInTheDocument();
    expect(await screen.findByText("selectedEvents:2")).toBeInTheDocument();
  });

  it("falls back to catch-up polling after repeated stream failures", async () => {
    mockSelectedTrace([{ event_id: "evt-3", sequence: 3, name: "Existing" }]);
    subscribeAdminApiTraceEvents
      .mockRejectedValueOnce(Object.assign(new Error("network 1"), { closeReason: "network_error" }))
      .mockRejectedValueOnce(Object.assign(new Error("network 2"), { closeReason: "network_error" }))
      .mockRejectedValueOnce(Object.assign(new Error("network 3"), { closeReason: "network_error" }))
      .mockImplementationOnce(() => new Promise(() => {}));
    getAdminApiTraceEvents.mockResolvedValueOnce({
      next_cursor: 7,
      items: [{ event_id: "evt-7", sequence: 7, name: "Fallback event" }],
    });

    renderProvider();

    await waitFor(() => expect(subscribeAdminApiTraceEvents).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(subscribeAdminApiTraceEvents).toHaveBeenCalledTimes(2), { timeout: 1200 });
    await waitFor(() => expect(subscribeAdminApiTraceEvents).toHaveBeenCalledTimes(3), { timeout: 1800 });
    await waitFor(() => expect(getAdminApiTraceEvents).toHaveBeenCalledWith("trace-1", 3));
    expect(await screen.findByText("connection:partial")).toBeInTheDocument();
    expect(await screen.findByText("selectedEvents:2")).toBeInTheDocument();
  }, 7000);

  it("stops retrying stale trace ids after projection reports expiration", async () => {
    const trace = mockSelectedTrace();
    getAdminApiTrace
      .mockResolvedValueOnce(trace)
      .mockRejectedValueOnce({ response: { status: 404, data: { detail: "Trace expired." } } });
    subscribeAdminApiTraceEvents.mockRejectedValueOnce(
      Object.assign(new Error("stale trace"), { status: 404 }),
    );

    renderProvider();

    await waitFor(() => expect(subscribeAdminApiTraceEvents).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("traceStatus:expired")).toBeInTheDocument();
    expect(screen.getByText("traceError:Trace expired.")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(subscribeAdminApiTraceEvents).toHaveBeenCalledTimes(1);
  });
});
