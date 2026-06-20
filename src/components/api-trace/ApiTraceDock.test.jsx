import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import { useApiTrace } from "../ApiTraceContext";
import ApiTraceDock from "./ApiTraceDock";

vi.mock("../ApiTraceContext", () => ({ useApiTrace: vi.fn() }));
vi.mock("../../utils/apiClient", () => ({ downloadAdminApiTrace: vi.fn() }));

const projection = {
  trace_id: "trace-1",
  surface: "catalog-studio",
  name: "Generate product draft",
  status: "completed",
  started_at: "2026-06-20T00:00:00Z",
  duration_ms: 240,
  payload_expired: false,
  attributes: { input: "safe", nested: { authorization: "Bearer secret" } },
  truncation: {},
  spans: [
    { span_id: "root", parent_span_id: null, name: "Generate product draft", operation: "ui.action", service: "browser", status: "completed", started_at: "2026-06-20T00:00:00Z", duration_ms: 240, attributes: {} },
  ],
  events: [
    { event_id: "event-1", span_id: "root", sequence: 0, name: "Draft started", event_type: "ui.started", status: "running", occurred_at: "2026-06-20T00:00:00Z", attributes: { phase: "draft" } },
  ],
  artifacts: [],
};

function traceState(overrides = {}) {
  return {
    authorized: true,
    available: true,
    enabled: true,
    recentTraces: [projection],
    recentStatus: "ready",
    selectedTraceId: projection.trace_id,
    selectedTrace: projection,
    traceStatus: "ready",
    connectionStatus: "live",
    traceError: "",
    selectTrace: vi.fn(),
    refreshTraces: vi.fn(),
    ...overrides,
  };
}

describe("ApiTraceDock", () => {
  beforeEach(() => {
    useApiTrace.mockReturnValue(traceState());
  });

  it("does not expose the dock to unauthorized or disabled users", () => {
    useApiTrace.mockReturnValue(traceState({ authorized: false }));
    renderWithProviders(<ApiTraceDock />);
    expect(screen.queryByLabelText("API trace visualizer")).not.toBeInTheDocument();
  });

  it("synchronizes event selection with the inspector and collapses with Escape", async () => {
    renderWithProviders(<ApiTraceDock />);
    await userEvent.click(screen.getByRole("tab", { name: "Events" }));
    await userEvent.click(screen.getByRole("option", { name: /Draft started/ }));

    expect(screen.getByText("Event inspector")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element.tagName === "PRE" && element.textContent.includes('"phase": "draft"'))).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("API trace visualizer"), { key: "Escape" });
    const collapsed = screen.getByRole("button", { name: /API traces/ });
    expect(collapsed).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(collapsed).toHaveFocus());
  });

  it("supports keyboard tab navigation and dock resizing", () => {
    renderWithProviders(<ApiTraceDock />);
    const waterfall = screen.getByRole("tab", { name: "Waterfall" });
    waterfall.focus();
    fireEvent.keyDown(waterfall, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Events" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Resize API trace dock" }), { key: "ArrowUp" });
    expect(screen.getByLabelText("API trace visualizer")).toHaveStyle({ height: "454px" });
  });

  it("copies a defense-in-depth sanitized projection", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderWithProviders(<ApiTraceDock />);

    await userEvent.click(screen.getAllByRole("button", { name: /^Copy$/ })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("[REDACTED]");
    expect(copied).not.toContain("Bearer secret");
  });

  it.each([
    ["reconnecting", "reconnecting"],
    ["partial", "partial"],
    ["expired", "expired"],
  ])("distinguishes the %s connection state", (connectionStatus, label) => {
    useApiTrace.mockReturnValue(traceState({ connectionStatus, traceStatus: connectionStatus === "expired" ? "expired" : "ready" }));
    renderWithProviders(<ApiTraceDock />);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });
});
