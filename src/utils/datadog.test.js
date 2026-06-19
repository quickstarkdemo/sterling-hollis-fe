import { beforeEach, describe, expect, it, vi } from "vitest";

const datadog = vi.hoisted(() => ({
  addAction: vi.fn(),
  logger: { info: vi.fn() },
}));

vi.mock("@datadog/browser-rum", () => ({ datadogRum: datadog }));
vi.mock("@datadog/browser-logs", () => ({ datadogLogs: datadog }));
vi.mock("@datadog/browser-rum-react", () => ({ reactPlugin: vi.fn(() => ({})) }));

import { getAllowedTracingUrls, trackCatalogStudioMilestone } from "./datadog";
import {
  configureApiTraceRuntime,
  resetApiTraceRuntimeForTests,
  startApiTraceAction,
} from "./apiTraceClient";

describe("trackCatalogStudioMilestone", () => {
  beforeEach(() => datadog.addAction.mockReset());

  it("emits only named milestones with bounded allowlisted context", () => {
    trackCatalogStudioMilestone("draft_command_finished", {
      product_id: "cat_safe",
      status: "succeeded",
      prompt: "private customer prompt",
      response_payload: { secret: "private provider response" },
      workflow_id: "w".repeat(500),
    });

    expect(datadog.addAction).toHaveBeenCalledWith("catalog_studio.milestone", {
      milestone: "draft_command_finished",
      product_id: "cat_safe",
      status: "succeeded",
      workflow_id: "w".repeat(200),
    });
  });

  it("ignores unknown milestone names", () => {
    trackCatalogStudioMilestone("send_entire_payload", { status: "no" });
    expect(datadog.addAction).not.toHaveBeenCalled();
  });
});

describe("Datadog resource tracing", () => {
  beforeEach(() => resetApiTraceRuntimeForTests());

  it("uses only W3C propagation while the app trace runtime is inactive", () => {
    const options = getAllowedTracingUrls();

    expect(options.length).toBeGreaterThan(0);
    expect(options.some((option) => option.match("https://sterling-hollis-be.quickstark.com/api/products"))).toBe(true);
    expect(options.every((option) => option.propagatorTypes.join(",") === "tracecontext")).toBe(true);
  });

  it("leaves W3C propagation to the app runtime during an active action", () => {
    configureApiTraceRuntime({ authorized: true, enabled: true });
    const action = startApiTraceAction("Datadog coexistence");
    const options = getAllowedTracingUrls();

    expect(options.some((option) => option.match("https://sterling-hollis-be.quickstark.com/api/products"))).toBe(false);
    action.end();
  });
});
