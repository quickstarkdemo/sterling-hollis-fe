import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminRoute, { CatalogStudioAccessProvider } from "../components/AdminRoute";
import DeveloperLensProvider from "../components/DeveloperLensProvider";
import Shell from "../components/Shell";
import { renderWithProviders } from "../test/render";
import CatalogStudioPage from "./CatalogStudioPage";

const clerk = vi.hoisted(() => ({
  state: {
    isLoaded: true,
    isSignedIn: true,
    getToken: vi.fn().mockResolvedValue("clerk-token"),
  },
}));
const api = vi.hoisted(() => ({
  archiveAdminCatalogProduct: vi.fn(),
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  getAdminCatalogProduct: vi.fn(),
  getAdminCatalogProducts: vi.fn(),
  getCatalogStudioSession: vi.fn(),
  publishAdminCatalogProduct: vi.fn(),
  saveAdminCatalogProductDraft: vi.fn(),
  startAdminCatalogProductRevision: vi.fn(),
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => clerk.state,
  SignedIn: ({ children }) => (clerk.state.isSignedIn ? children : null),
  SignedOut: ({ children }) => (clerk.state.isSignedIn ? null : children),
  UserButton: Object.assign(({ children }) => <div data-testid="user-button">{children}</div>, {
    MenuItems: ({ children }) => <div>{children}</div>,
    Link: ({ href, label }) => <a href={href}>{label}</a>,
    Action: ({ label }) => <button type="button">{label}</button>,
    UserProfilePage: ({ children }) => <div>{children}</div>,
  }),
  SignInButton: ({ children }) => children,
}));
vi.mock("../utils/apiClient", () => api);
vi.mock("../utils/clerkConfig", () => ({
  CLERK_ENABLED: true,
  isDemoObservabilityUiEnabled: () => false,
}));
vi.mock("../components/ChatWidget", () => ({ default: () => null }));
vi.mock("../components/DemoObservabilityPanel", () => ({ default: () => null }));

const session = {
  authorized: true,
  capabilities: {
    responses: { configured: true },
    moderation: { configured: true },
    image_generation: { configured: true },
    realtime: { configured: false },
    worker_storage: { configured: true },
    catalog: { configured: true },
  },
};

function renderStudio() {
  return renderWithProviders(
    <CatalogStudioAccessProvider>
      <DeveloperLensProvider>
        <Shell>
          <AdminRoute>
            <CatalogStudioPage />
          </AdminRoute>
        </Shell>
      </DeveloperLensProvider>
    </CatalogStudioAccessProvider>,
    { route: "/catalog-studio" },
  );
}

describe("CatalogStudioPage", () => {
  beforeEach(() => {
    clerk.state = {
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("clerk-token"),
    };
    api.getCatalogStudioSession.mockReset().mockResolvedValue(session);
    api.getAdminCatalogProducts.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 12 });
    api.getAdminCatalogProduct.mockReset();
  });

  it("keeps Catalog Studio undiscoverable for anonymous storefront visitors", async () => {
    clerk.state = { isLoaded: true, isSignedIn: false, getToken: vi.fn() };

    renderStudio();

    expect(screen.getByText("Sign in to Catalog Studio")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Catalog Studio" })).not.toBeInTheDocument();
    expect(api.getCatalogStudioSession).not.toHaveBeenCalled();
  });

  it("shows authorized navigation and a business-first capability view", async () => {
    renderStudio();

    expect(await screen.findByRole("heading", { name: "Build and manage the product catalog" })).toBeInTheDocument();
    expect(screen.getAllByText("Catalog Studio").length).toBeGreaterThan(1);
    expect(screen.getByText("Responses")).toBeInTheDocument();
    expect(screen.getByText("Realtime voice")).toBeInTheDocument();
    expect(screen.queryByText("Technical view")).not.toBeInTheDocument();
    const studioLinks = screen.getAllByRole("link", { name: "Catalog Studio" });
    expect(studioLinks).toHaveLength(2);
    expect(studioLinks[0]).toHaveAttribute("href", "/catalog-studio");
  });

  it("persists the developer lens for the browser session", async () => {
    const user = userEvent.setup();
    const firstRender = renderStudio();
    await screen.findByRole("heading", { name: "Build and manage the product catalog" });

    await user.click(screen.getByRole("button", { name: "Developer lens off" }));

    expect(screen.getByText("Technical view")).toBeInTheDocument();
    expect(sessionStorage.getItem("sterling-hollis:catalog-studio:developer-lens")).toBe("enabled");

    firstRender.unmount();
    renderStudio();

    expect(await screen.findByRole("button", { name: "Developer lens on" })).toHaveAttribute("aria-pressed", "true");
  });

  it("warns before switching away from a dirty product", async () => {
    const products = [
      { product_id: "cat_one", lifecycle_status: "published", version: 1, title: "First Coat", brand: "Sterling Hollis", category: "womens_apparel", has_draft: true, current_draft_version: 1, updated_at: "2026-06-17T12:00:00Z" },
      { product_id: "cat_two", lifecycle_status: "published", version: 1, title: "Second Coat", brand: "Sterling Hollis", category: "womens_apparel", has_draft: false, updated_at: "2026-06-17T12:00:00Z" },
    ];
    api.getAdminCatalogProducts.mockResolvedValue({ items: products, total: 2, page: 1, page_size: 12 });
    api.getAdminCatalogProduct.mockResolvedValue({
      product_id: "cat_one",
      lifecycle_status: "published",
      version: 1,
      title: "First Coat",
      description: "Description",
      brand: "Sterling Hollis",
      category: "womens_apparel",
      metadata: {},
      published_snapshot: null,
      current_draft: {
        revision: { id: "draft_1", moderation_state: "approved" },
        draft_version: 1,
        product: {
          product_id: "cat_one", seed_run_id: "run", title: "First Coat", description: "Description", brand: "Sterling Hollis", category: "womens_apparel", metadata: {}, variant_axes: [], primary_variant_index: 0,
          variants: [{ variant_id: "var_1", color: "Black", material: "wool", price_min: 10, price_max: 10, image_set: {}, metadata: {}, inventory: [{ store_id: "1001", size: "M", availability: "in stock", inventory_qty: 1, objective_weight: 0, metadata: {} }] }],
        },
      },
      drafts: [],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderStudio();

    await userEvent.click(await screen.findByRole("button", { name: /First Coat/i }));
    const title = await screen.findByLabelText("Product title");
    await userEvent.clear(title);
    await userEvent.type(title, "Unsaved Coat");
    await userEvent.click(screen.getByRole("button", { name: /Second Coat/i }));

    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes and open another product?");
    expect(screen.getByDisplayValue("Unsaved Coat")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Shop" }));
    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes and leave Catalog Studio?");
  });
});
