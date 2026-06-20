import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import TraceEventLog from "./TraceEventLog";

describe("TraceEventLog", () => {
  it("orders late events by sequence and selects one shared event", () => {
    const onSelect = vi.fn();
    const events = [
      { event_id: "later", sequence: 4, name: "Completed", event_type: "http.completed", occurred_at: "2026-06-20T00:00:04Z" },
      { event_id: "earlier", sequence: 1, name: "Started", event_type: "http.started", occurred_at: "2026-06-20T00:00:01Z" },
    ];
    renderWithProviders(<TraceEventLog events={events} selection={null} onSelect={onSelect} />);

    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Started");
    fireEvent.click(screen.getByRole("option", { name: /Completed/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "event", id: "later" });
  });
});
