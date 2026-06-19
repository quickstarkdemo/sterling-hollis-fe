import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductDraftPreview from "./ProductDraftPreview";

it("renders the canonical draft gallery, copy, price, and availability", () => {
  renderWithProviders(<ProductDraftPreview payload={{ draft_version: 4, preview: {
    title: "Studio Coat",
    brand: "Sterling Hollis",
    description: "A structured wool coat.",
    price_min: 250,
    price_max: 300,
    benefits: ["Warm without bulk"],
    media: [{ media_id: "main", display_order: 0, alt_text: "Black coat", image_set: { primary_url: "https://example.com/coat.jpg" } }],
    inventory: [{ store_id: "1001", size: "M", availability: "in stock", inventory_qty: 5 }],
  } }} />);

  expect(screen.getByRole("img", { name: "Black coat" })).toHaveAttribute("src", "https://example.com/coat.jpg");
  expect(screen.getByText("A structured wool coat.")).toBeInTheDocument();
  expect(screen.getByText(/\$250\.00/)).toBeInTheDocument();
  expect(screen.getByText("1001 · M: in stock (5)")).toBeInTheDocument();
});
