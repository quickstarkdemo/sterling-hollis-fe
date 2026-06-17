import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import CatalogProductList from "./CatalogProductList";

const api = vi.hoisted(() => ({ getAdminCatalogProducts: vi.fn() }));
vi.mock("../../utils/apiClient", () => api);

const products = [
  { product_id: "cat_published", lifecycle_status: "published", version: 2, title: "Wool Coat", brand: "Sterling Hollis", category: "womens_apparel", has_draft: false, updated_at: "2026-06-17T12:00:00Z" },
  { product_id: "cat_draft", lifecycle_status: "draft", version: 0, title: "Silk Dress", brand: "Sterling Hollis", category: "womens_apparel", has_draft: true, current_draft_version: 3, updated_at: "2026-06-17T12:00:00Z" },
  { product_id: "cat_archived", lifecycle_status: "archived", version: 4, title: "Leather Tote", brand: "Sterling Hollis", category: "handbags", has_draft: false, updated_at: "2026-06-17T12:00:00Z" },
];

describe("CatalogProductList", () => {
  beforeEach(() => {
    api.getAdminCatalogProducts.mockReset().mockResolvedValue({ items: products, total: 3, page: 1, page_size: 12 });
  });

  it("renders every lifecycle state and selects a product", async () => {
    const onSelect = vi.fn();
    renderWithProviders(<CatalogProductList selectedProductId="" onSelect={onSelect} />);

    expect(await screen.findByText("Wool Coat")).toBeInTheDocument();
    expect(screen.getByText("Silk Dress")).toBeInTheDocument();
    expect(screen.getByText("Leather Tote")).toBeInTheDocument();
    expect(screen.getByText("Draft v3")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Silk Dress/i }));
    expect(onSelect).toHaveBeenCalledWith("cat_draft");
  });

  it("sends search and lifecycle filters to the administrator contract", async () => {
    renderWithProviders(<CatalogProductList selectedProductId="" onSelect={() => {}} />);
    await screen.findByText("Wool Coat");

    await userEvent.type(screen.getByLabelText("Search catalog products"), "coat");
    await userEvent.selectOptions(screen.getByLabelText("Lifecycle status"), "published");

    await waitFor(() => {
      expect(api.getAdminCatalogProducts).toHaveBeenLastCalledWith(expect.objectContaining({
        q: "coat",
        lifecycle_status: "published",
        page: 1,
        page_size: 12,
      }));
    });
  });
});
