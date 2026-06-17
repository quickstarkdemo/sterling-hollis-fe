import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminRoute, { CatalogStudioAccessProvider } from "./AdminRoute";
import { renderWithProviders } from "../test/render";

const clerk = vi.hoisted(() => ({
  state: { isLoaded: true, isSignedIn: true, getToken: vi.fn() },
}));
const api = vi.hoisted(() => ({ getCatalogStudioSession: vi.fn() }));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => clerk.state,
}));
vi.mock("../utils/apiClient", () => api);
vi.mock("../utils/clerkConfig", () => ({ CLERK_ENABLED: true }));

function renderRoute() {
  return renderWithProviders(
    <CatalogStudioAccessProvider>
      <AdminRoute>
        <div>Protected studio content</div>
      </AdminRoute>
    </CatalogStudioAccessProvider>,
  );
}

describe("AdminRoute", () => {
  beforeEach(() => {
    clerk.state = {
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("clerk-token"),
    };
    api.getCatalogStudioSession.mockReset();
  });

  it("waits for Clerk before resolving administrator access", () => {
    clerk.state = { isLoaded: false, isSignedIn: false, getToken: vi.fn() };

    renderRoute();

    expect(screen.getByText("Verifying Catalog Studio access")).toBeInTheDocument();
    expect(api.getCatalogStudioSession).not.toHaveBeenCalled();
  });

  it("asks anonymous visitors to sign in without calling the administrator API", () => {
    clerk.state = { isLoaded: true, isSignedIn: false, getToken: vi.fn() };

    renderRoute();

    expect(screen.getByText("Sign in to Catalog Studio")).toBeInTheDocument();
    expect(api.getCatalogStudioSession).not.toHaveBeenCalled();
  });

  it("shows a forbidden state for a valid non-administrator", async () => {
    api.getCatalogStudioSession.mockRejectedValue({ response: { status: 403 } });

    renderRoute();

    expect(await screen.findByText("Administrator access required")).toBeInTheDocument();
    expect(screen.queryByText("Protected studio content")).not.toBeInTheDocument();
  });

  it("renders protected content only after the backend authorizes the session", async () => {
    api.getCatalogStudioSession.mockResolvedValue({ authorized: true, capabilities: {} });

    renderRoute();

    expect(await screen.findByText("Protected studio content")).toBeInTheDocument();
    expect(api.getCatalogStudioSession).toHaveBeenCalledWith("clerk-token");
  });

  it("fails closed when the administrator session response is not authorized", async () => {
    api.getCatalogStudioSession.mockResolvedValue({ authorized: false, capabilities: {} });

    renderRoute();

    expect(await screen.findByText("Administrator access required")).toBeInTheDocument();
    expect(screen.queryByText("Protected studio content")).not.toBeInTheDocument();
  });

  it("keeps backend failures retryable", async () => {
    const user = userEvent.setup();
    api.getCatalogStudioSession
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ authorized: true, capabilities: {} });

    renderRoute();
    expect(await screen.findByText("Catalog Studio is unavailable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Protected studio content")).toBeInTheDocument();
    expect(api.getCatalogStudioSession).toHaveBeenCalledTimes(2);
  });
});
