import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DeveloperLensProvider from "../DeveloperLensProvider";
import { renderWithProviders } from "../../test/render";
import DeveloperLens from "./DeveloperLens";

const events = [{
  id: "event_1",
  sequence: 1,
  stage: "responses",
  capability: "responses",
  status: "succeeded",
  developer: {
    model: "gpt-5",
    request_id: "req_safe",
    duration_ms: 120,
    request_payload: { instruction_summary: "safe", authorization: "Bearer private-token", nested: { api_key: "sk-private" } },
    response_payload: { title: "Safe coat", chain_of_thought: "private reasoning" },
    usage: { input_tokens: 12 },
    moderation: { allowed: true },
  },
}];

describe("DeveloperLens", () => {
  beforeEach(() => {
    sessionStorage.setItem("sterling-hollis:catalog-studio:developer-lens", "enabled");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders and copies only sanitized bounded projections", async () => {
    renderWithProviders(<DeveloperLensProvider><DeveloperLens events={events} /></DeveloperLensProvider>);

    expect(screen.getByText("Sanitized API metadata")).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.queryByText(/private-token/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-private/)).not.toBeInTheDocument();
    expect(screen.queryByText(/private reasoning/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/REDACTED/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    const copied = navigator.clipboard.writeText.mock.calls[0][0];
    expect(copied).not.toContain("private-token");
    expect(copied).not.toContain("sk-private");
    expect(copied).not.toContain("private reasoning");
    expect(copied).toContain("[REDACTED]");
  });
});
