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
const api = vi.hoisted(() => ({ getCatalogStudioSession: vi.fn() }));

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
});
