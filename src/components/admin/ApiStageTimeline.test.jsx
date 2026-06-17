import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import ApiStageTimeline from "./ApiStageTimeline";

describe("ApiStageTimeline", () => {
  it("renders Responses and Moderation as separate backend stages", () => {
    renderWithProviders(<ApiStageTimeline events={[
      { id: "event_1", sequence: 1, capability: "responses", stage: "responses", status: "succeeded", business_summary: "Structured the draft." },
      { id: "event_2", sequence: 2, capability: "moderation", stage: "moderation", status: "blocked", business_summary: "Stopped by policy." },
    ]} />);

    expect(screen.getByText("Responses")).toBeInTheDocument();
    expect(screen.getByText("Structured the draft.")).toBeInTheDocument();
    expect(screen.getByText("Moderation")).toBeInTheDocument();
    expect(screen.getByText("Stopped by policy.")).toBeInTheDocument();
    expect(screen.getByText("Image Generation")).toBeInTheDocument();
    expect(screen.getAllByText("pending").length).toBeGreaterThan(0);
  });
});
