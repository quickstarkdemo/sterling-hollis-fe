import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import TraceWaterfall from "./TraceWaterfall";

const trace = {
  spans: [
    { span_id: "root", parent_span_id: null, name: "Root", service: "browser", status: "completed", started_at: "2026-06-20T00:00:00Z", duration_ms: 0 },
    { span_id: "slow", parent_span_id: "root", name: "Parallel request", service: "api", status: "running", started_at: "2026-06-20T00:00:00Z", duration_ms: null },
  ],
};

describe("TraceWaterfall", () => {
  it("renders zero and unknown durations safely and synchronizes selection", () => {
    const onSelect = vi.fn();
    renderWithProviders(<TraceWaterfall trace={trace} selection={null} onSelect={onSelect} />);

    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByRole("option", { name: /Parallel request/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "span", id: "slow" });
  });
});
