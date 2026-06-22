import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import { useApiTrace } from "../ApiTraceContext";
import ApiTraceDock from "./ApiTraceDock";

vi.mock("../ApiTraceContext", () => ({ useApiTrace: vi.fn() }));
vi.mock("../../utils/apiClient", () => ({ downloadAdminApiTrace: vi.fn() }));
vi.mock("./TraceGraph", () => ({
  default: ({ trace, onSelect }) => (
    <button type="button" onClick={() => onSelect({ kind: "span", id: trace.spans[0].span_id })}>
      Graph spans {trace.spans.length}
    </button>
  ),
}));

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
    deleteTraceIds: vi.fn(),
    refreshTraces: vi.fn(),
    ...overrides,
  };
}

describe("ApiTraceDock", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useApiTrace.mockReturnValue(traceState());
  });

  it.each([
    { authorized: false },
    { available: false },
    { enabled: false },
  ])("does not expose the dock when trace access is %o", (overrides) => {
    useApiTrace.mockReturnValue(traceState(overrides));
    renderWithProviders(<ApiTraceDock />);
    expect(screen.queryByLabelText("API trace visualizer")).not.toBeInTheDocument();
  });

  it("opens from the compact Dev Tools tray and persists collapse preference", async () => {
    renderWithProviders(<ApiTraceDock />);
    const tray = screen.getByRole("button", { name: /Dev Tools/ });
    expect(tray).toHaveAttribute("aria-expanded", "false");
    expect(tray).toHaveTextContent("1");

    await userEvent.click(tray);
    expect(screen.getByRole("tab", { name: "Graph" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Waterfall" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Artifacts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Inspector" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Collapse API trace dock" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Dev Tools/ })).toHaveFocus());
    expect(JSON.parse(sessionStorage.getItem("sterling-hollis:api-trace-dock:v1")).expanded).toBe(false);
  });

  it("synchronizes event selection with the inspector and collapses with Escape", async () => {
    sessionStorage.setItem("sterling-hollis:api-trace-dock:v1", JSON.stringify({ expanded: true }));
    renderWithProviders(<ApiTraceDock />);
    await userEvent.click(screen.getByRole("tab", { name: "Events" }));
    await userEvent.click(screen.getByRole("option", { name: /Draft started/ }));

    expect(screen.getByText("Event inspector")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element.tagName === "PRE" && element.textContent.includes('"phase": "draft"'))).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("API trace visualizer"), { key: "Escape" });
    const collapsed = screen.getByRole("button", { name: /Dev Tools/ });
    expect(collapsed).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(collapsed).toHaveFocus());
  });

  it("supports keyboard tab navigation and dock resizing", () => {
    sessionStorage.setItem("sterling-hollis:api-trace-dock:v1", JSON.stringify({ expanded: true }));
    renderWithProviders(<ApiTraceDock />);
    const waterfall = screen.getByRole("tab", { name: "Waterfall" });
    waterfall.focus();
    fireEvent.keyDown(waterfall, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Events" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Resize API trace dock" }), { key: "ArrowUp" });
    expect(screen.getByLabelText("API trace visualizer")).toHaveStyle({ height: "454px" });
  });

  it("opens full screen and keeps a return path to the product catalog", async () => {
    sessionStorage.setItem("sterling-hollis:api-trace-dock:v1", JSON.stringify({ expanded: true }));
    renderWithProviders(<ApiTraceDock />);

    await userEvent.click(screen.getByRole("button", { name: "Open trace dock full screen" }));
    expect(screen.getByLabelText("API trace visualizer")).toHaveClass("fullscreen");
    expect(screen.getByRole("link", { name: "Return to product catalog" })).toHaveAttribute("href", "/catalog-studio");
    expect(screen.queryByRole("button", { name: "Resize API trace dock" })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("API trace visualizer"), { key: "Escape" });
    expect(screen.getByLabelText("API trace visualizer")).toHaveClass("dock");
  });

  it("synchronizes graph selection and replays the immutable projection without a request", async () => {
    sessionStorage.setItem("sterling-hollis:api-trace-dock:v1", JSON.stringify({ expanded: true }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderWithProviders(<ApiTraceDock />);

    const graph = await screen.findByRole("button", { name: "Graph spans 1" });
    await userEvent.click(graph);
    expect(screen.getByText("Span inspector")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Replay trace" }));
    expect(screen.getByLabelText("Trace replay controls")).toBeInTheDocument();
    expect(screen.getByText("replaying")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "240" } });
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("moves waterfall selection to the replayed operation", async () => {
    sessionStorage.setItem("sterling-hollis:api-trace-dock:v1", JSON.stringify({ expanded: true, view: "waterfall" }));
    const trace = {
      ...projection,
      duration_ms: 240,
      spans: [
        projection.spans[0],
        { span_id: "child", parent_span_id: "root", name: "Backend call", operation: "http.client", service: "api", status: "completed", started_at: "2026-06-20T00:00:00.100Z", completed_at: "2026-06-20T00:00:00.180Z", duration_ms: 80, attributes: {} },
      ],
      events: [
        projection.events[0],
        { event_id: "event-2", span_id: "child", sequence: 1, name: "Backend completed", event_type: "http.completed", status: "completed", occurred_at: "2026-06-20T00:00:00.180Z", attributes: { endpoint: "/api/products" } },
      ],
    };
    useApiTrace.mockReturnValue(traceState({
      recentTraces: [trace],
      selectedTrace: trace,
      selectedTraceId: trace.trace_id,
    }));
    renderWithProviders(<ApiTraceDock />);

    await userEvent.click(screen.getByRole("button", { name: "Replay trace" }));
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "200" } });

    await waitFor(() => expect(screen.getAllByText("Backend completed").length).toBeGreaterThan(0));
    expect(screen.getByRole("option", { name: /Backend call/ })).toHaveAttribute("aria-selected", "true");
  });

  it("copies the full trace projection for developer analysis", async () => {
    sessionStorage.setItem("sterling-hollis:api-trace-dock:v1", JSON.stringify({ expanded: true }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderWithProviders(<ApiTraceDock />);

    await userEvent.click(screen.getAllByRole("button", { name: /^Copy$/ })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("Bearer secret");
    expect(copied).toContain("Generate product draft");
  });

  it("supports deleting the current trace and batch selecting recent traces", async () => {
    sessionStorage.setItem("sterling-hollis:api-trace-dock:v1", JSON.stringify({ expanded: true }));
    const deleteTraceIds = vi.fn();
    useApiTrace.mockReturnValue(traceState({ deleteTraceIds }));
    renderWithProviders(<ApiTraceDock />);

    await userEvent.click(screen.getByRole("button", { name: "Delete current trace" }));
    expect(deleteTraceIds).toHaveBeenCalledWith(["trace-1"]);

    await userEvent.click(screen.getByRole("button", { name: "Manage" }));
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await userEvent.click(screen.getByRole("button", { name: /Delete 1/ }));
    expect(deleteTraceIds).toHaveBeenLastCalledWith(["trace-1"]);
  });

  it.each([
    ["reconnecting", "reconnecting"],
    ["partial", "partial"],
    ["expired", "expired"],
  ])("distinguishes the %s connection state", (connectionStatus, label) => {
    sessionStorage.setItem("sterling-hollis:api-trace-dock:v1", JSON.stringify({ expanded: true }));
    useApiTrace.mockReturnValue(traceState({ connectionStatus, traceStatus: connectionStatus === "expired" ? "expired" : "ready" }));
    renderWithProviders(<ApiTraceDock />);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });
});
