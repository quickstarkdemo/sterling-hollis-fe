import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import TraceInspector from "./TraceInspector";

describe("TraceInspector", () => {
  it("shows payload expiry and redacts nested secrets", () => {
    const trace = {
      trace_id: "trace-1",
      name: "Draft product",
      surface: "catalog-studio",
      status: "completed",
      payload_expired: true,
      truncation: { attributes: 2 },
      attributes: { safe: "visible", nested: { access_token: "do-not-render" } },
      spans: [],
      events: [],
      artifacts: [],
    };
    renderWithProviders(<TraceInspector trace={trace} selection={{ kind: "trace", id: "trace-1" }} />);

    expect(screen.getByText(/Detailed payloads have expired/)).toBeInTheDocument();
    expect(screen.getByText(/server truncated fields/)).toBeInTheDocument();
    expect(screen.getByText(/visible/)).toBeInTheDocument();
    expect(screen.queryByText(/do-not-render/)).not.toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
  });
});
