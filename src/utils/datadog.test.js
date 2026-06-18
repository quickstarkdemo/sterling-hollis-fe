import { beforeEach, describe, expect, it, vi } from "vitest";

const datadog = vi.hoisted(() => ({
  addAction: vi.fn(),
  logger: { info: vi.fn() },
}));

vi.mock("@datadog/browser-rum", () => ({ datadogRum: datadog }));
vi.mock("@datadog/browser-logs", () => ({ datadogLogs: datadog }));
vi.mock("@datadog/browser-rum-react", () => ({ reactPlugin: vi.fn(() => ({})) }));

import { trackCatalogStudioMilestone } from "./datadog";

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
