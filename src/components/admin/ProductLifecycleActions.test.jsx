import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductLifecycleActions from "./ProductLifecycleActions";
import {
  configureApiTraceRuntime,
  resetApiTraceRuntimeForTests,
  subscribeApiTraceEvents,
} from "../../utils/apiTraceClient";

const api = vi.hoisted(() => ({
  archiveAdminCatalogProduct: vi.fn(),
  archiveAdminCatalogProductCurrentV2: vi.fn(),
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  publishAdminCatalogProduct: vi.fn(),
  publishAdminCatalogProductCompatibilityV2: vi.fn(),
  publishAdminCatalogProductV3: vi.fn(),
}));
vi.mock("../../utils/apiClient", () => api);

const product = {
  product_id: "cat_coat",
  lifecycle_status: "published",
  version: 4,
  current_draft: { revision: { id: "draft_1", moderation_state: "approved" }, draft_version: 2 },
};

describe("ProductLifecycleActions", () => {
  beforeEach(() => {
    resetApiTraceRuntimeForTests();
    api.publishAdminCatalogProduct.mockReset().mockResolvedValue({ product_id: "cat_coat", lifecycle_status: "published", version: 5 });
    api.archiveAdminCatalogProduct.mockReset().mockResolvedValue({ product_id: "cat_coat", lifecycle_status: "archived", version: 5 });
    api.archiveAdminCatalogProductCurrentV2.mockReset().mockResolvedValue({ product_id: "cat_coat", lifecycle_status: "archived", version: 5 });
    api.publishAdminCatalogProductCompatibilityV2.mockReset().mockResolvedValue({ product_id: "cat_coat", lifecycle_status: "published", version: 5 });
    api.publishAdminCatalogProductV3.mockReset().mockResolvedValue({ product_id: "cat_coat", lifecycle_status: "published", version: 5 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("publishes through the canonical lifecycle when schema v2 is active", async () => {
    renderWithProviders(<ProductLifecycleActions product={product} dirty={false} onChanged={() => {}} authoringSchemaVersion={2} />);

    await userEvent.click(screen.getByRole("button", { name: /Publish draft/i }));

    expect(api.publishAdminCatalogProductCompatibilityV2).toHaveBeenCalledWith(
      "cat_coat",
      { draft_id: "draft_1", expected_version: 4 },
      "publish-product-key",
    );
    expect(api.publishAdminCatalogProduct).not.toHaveBeenCalled();
  });

  it("registers publish actions with the selected API trace", async () => {
    configureApiTraceRuntime({ authorized: true, enabled: true, surface: "catalog-studio" });
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    renderWithProviders(<ProductLifecycleActions product={product} dirty={false} onChanged={() => {}} authoringSchemaVersion={2} />);

    await userEvent.click(screen.getByRole("button", { name: /Publish draft/i }));

    await waitFor(() => expect(events.map((event) => event.event_type)).toContain("ui.completed"));
    expect(events[0]).toMatchObject({
      event_type: "ui.started",
      attributes: expect.objectContaining({
        action: "product_publish",
        draft_id: "draft_1",
        product_id: "cat_coat",
        surface: "catalog-studio",
      }),
    });
  });

  it("uses v3 publish and blocks it only for deterministic readiness errors", async () => {
    const view = renderWithProviders(<ProductLifecycleActions product={product} dirty={false} onChanged={() => {}} authoringSchemaVersion={3} readiness={{ ready: true, blocking_errors: [], recommendations: [] }} />);
    await userEvent.click(screen.getByRole("button", { name: /Publish draft/i }));
    expect(api.publishAdminCatalogProductV3).toHaveBeenCalledWith("cat_coat", { draft_id: "draft_1", expected_version: 4 }, "publish-product-key");

    view.unmount();
    renderWithProviders(<ProductLifecycleActions product={product} dirty={false} onChanged={() => {}} authoringSchemaVersion={3} readiness={{ ready: false, blocking_errors: [{ code: "missing_price" }], recommendations: [] }} />);
    expect(screen.getByRole("button", { name: /Publish draft/i })).toBeDisabled();
    expect(screen.getByText(/Resolve the blocking readiness issues/i)).toBeInTheDocument();
  });

  it("requires confirmation, publishes the expected draft version, and links to the public product", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ProductLifecycleActions product={product} dirty={false} onChanged={onChanged} />);

    expect(screen.getByRole("link", { name: /View public product/i })).toHaveAttribute("href", "/product/cat_coat");
    await userEvent.click(screen.getByRole("button", { name: /Publish draft/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(api.publishAdminCatalogProductV3).toHaveBeenCalledWith(
      "cat_coat",
      { draft_id: "draft_1", expected_version: 4 },
      "publish-product-key",
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("published"));
  });

  it("blocks lifecycle mutations while local edits are dirty", () => {
    renderWithProviders(<ProductLifecycleActions product={product} dirty onChanged={() => {}} />);
    expect(screen.getByRole("button", { name: /Publish draft/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Archive/i })).toBeDisabled();
    expect(screen.getByText(/Save or discard local edits/i)).toBeInTheDocument();
  });

  it("archives the published version only after confirmation", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ProductLifecycleActions product={product} dirty={false} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole("button", { name: /^Archive$/i }));

    expect(window.confirm).toHaveBeenCalledWith("Archive this product and remove it from public catalog results?");
    expect(api.archiveAdminCatalogProductCurrentV2).toHaveBeenCalledWith(
      "cat_coat",
      { expected_version: 4 },
      "archive-product-key",
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("archived"));
  });

  it("explains archive as the supported non-destructive removal action", () => {
    renderWithProviders(<ProductLifecycleActions product={product} dirty={false} onChanged={() => {}} />);
    expect(screen.getByText(/catalog records are retained instead of permanently deleted/i)).toBeInTheDocument();
  });
});
