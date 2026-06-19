import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

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

describe("ApiTraceProvider", () => {
  beforeEach(() => {
    resetApiTraceRuntimeForTests();
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
  });

  it("resets the session-scoped runtime when the provider unmounts", async () => {
    const view = renderProvider();
    expect(await screen.findByText("enabled:true")).toBeInTheDocument();

    view.unmount();

    expect(startApiTraceAction("After unmount").enabled).toBe(false);
  });
});
