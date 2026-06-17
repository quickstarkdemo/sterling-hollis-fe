import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import DemoObservabilityPanel from "./DemoObservabilityPanel";

const api = vi.hoisted(() => ({
  getDemoObservabilityState: vi.fn(),
  updateDemoObservabilityState: vi.fn(),
  resetDemoObservabilityState: vi.fn(),
}));

vi.mock("../utils/apiClient", () => ({
  DEFAULT_STORE_ID: "1001",
  ...api,
}));
vi.mock("../utils/datadog", () => ({ trackAction: vi.fn() }));

beforeEach(() => {
  api.getDemoObservabilityState.mockReset();
  api.updateDemoObservabilityState.mockReset();
  api.resetDemoObservabilityState.mockReset();
});

it("renders protected API authorization failures without trying another endpoint", async () => {
  api.getDemoObservabilityState.mockRejectedValue({
    response: { status: 403, data: { detail: "Clerk user is not a Catalog Studio administrator." } },
  });

  renderWithProviders(<DemoObservabilityPanel />);

  expect(await screen.findByText("Clerk user is not a Catalog Studio administrator.")).toBeInTheDocument();
  expect(api.getDemoObservabilityState).toHaveBeenCalledTimes(1);
});
