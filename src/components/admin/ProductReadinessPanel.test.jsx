import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductReadinessPanel from "./ProductReadinessPanel";

it("separates publication blockers from non-blocking recommendations", () => {
  renderWithProviders(<ProductReadinessPanel readiness={{
    ready: false,
    blocking_errors: [{ code: "missing_price", field_path: "/price_min", message: "A positive price is required." }],
    recommendations: [{ code: "missing_seo_title", field_path: "/seo/title", message: "Add a search title." }],
  }} />);

  expect(screen.getByText("Blocked")).toBeInTheDocument();
  expect(screen.getByText("A positive price is required.")).toBeInTheDocument();
  expect(screen.getByText("Add a search title.")).toBeInTheDocument();
});
