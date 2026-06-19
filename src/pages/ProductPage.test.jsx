import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatContext } from "../components/ChatContext";
import { renderWithProviders } from "../test/render";
import ProductPage from "./ProductPage";

const api = vi.hoisted(() => ({
  getProduct: vi.fn(),
  getProductRecommendations: vi.fn(),
  getRelatedProducts: vi.fn(),
}));
vi.mock("../utils/apiClient", () => ({ DEFAULT_STORE_ID: "1001", ...api }));
vi.mock("../utils/datadog", () => ({ trackAction: vi.fn() }));

const product = {
  id: "cat_pillow",
  title: "Augustin Mercer Black Pillow",
  description: "A black accent pillow.",
  brand: "Augustin Mercer",
  category: "home",
  price: 120,
  price_min: 120,
  price_max: 120,
  attributes: { color: "black" },
  inventory_summary: { availability: "in_stock", in_stock_units: 7, store_count: 1 },
  inventory: [{ store_id: "1001", size: "One Size", inventory_qty: 7, stock_state: "in_stock", availability: "in_stock" }],
  images: { primary_url: "https://example.com/legacy.jpg", detail_urls: [] },
  media: [
    { id: "media_core", role: "core", intent: "manual", display_order: 0, images: { primary_url: "https://example.com/core.jpg", detail_urls: [] } },
    { id: "media_room", role: "variation", intent: "scene", display_order: 1, images: { primary_url: "https://example.com/room.jpg", detail_urls: [] } },
  ],
  variants: [{
    id: "var_black",
    product_id: "cat_pillow",
    price_min: 120,
    price_max: 120,
    attributes: { color: "black" },
    sizes: ["One Size"],
    inventory: [{ inventory_qty: 7, stock_state: "in_stock" }],
  }],
};

function renderPage() {
  return renderWithProviders(
    <ChatContext.Provider value={{ chatContext: {}, setChatContext: vi.fn() }}>
      <Routes><Route path="/product/:productId" element={<ProductPage />} /></Routes>
    </ChatContext.Provider>,
    { route: "/product/cat_pillow" },
  );
}

describe("ProductPage media gallery", () => {
  beforeEach(() => {
    api.getProduct.mockReset().mockResolvedValue(product);
    api.getRelatedProducts.mockReset().mockResolvedValue({ items: [] });
    api.getProductRecommendations.mockReset().mockResolvedValue({ recommendations: [] });
  });

  it("switches approved gallery views without changing product price or inventory", async () => {
    renderPage();

    expect(await screen.findByRole("img", { name: "Augustin Mercer Black Pillow view 1" })).toHaveAttribute("src", "https://example.com/core.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Show product view 2" }));
    expect(screen.getByRole("img", { name: "Augustin Mercer Black Pillow view 2" })).toHaveAttribute("src", "https://example.com/room.jpg");
    expect(screen.getByText("7 in stock")).toBeInTheDocument();
    expect(screen.getByText("$120")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Store availability" })).toBeInTheDocument();
    expect(screen.getByText("Store 1001")).toBeInTheDocument();
    expect(screen.queryByText("Sellable options and inventory")).not.toBeInTheDocument();
    expect(screen.getByText(/does not change price or availability/i)).toBeInTheDocument();
  });

  it("keeps products unavailable when the public API no longer publishes them", async () => {
    api.getProduct.mockRejectedValueOnce({ response: { status: 404 } });
    renderPage();

    expect(await screen.findByText("Product unavailable")).toBeInTheDocument();
    expect(screen.queryByText(product.title)).not.toBeInTheDocument();
  });
});
