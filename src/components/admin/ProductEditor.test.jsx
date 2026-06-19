import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductEditor from "./ProductEditor";

const api = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  approveCatalogImageJob: vi.fn(),
  getAdminCatalogProduct: vi.fn(),
  getCatalogImageJob: vi.fn(),
  saveAdminCatalogProductDraft: vi.fn(),
  startCatalogWorkflow: vi.fn(),
  startAdminCatalogProductRevision: vi.fn(),
  submitCatalogMediaCommand: vi.fn(),
  archiveAdminCatalogProduct: vi.fn(),
  publishAdminCatalogProduct: vi.fn(),
  getAdminCatalogProductV2: vi.fn(),
  saveAdminCatalogProductDraftV2: vi.fn(),
  startAdminCatalogProductRevisionV2: vi.fn(),
  createAdminCatalogBrand: vi.fn(),
  archiveAdminCatalogProductV2: vi.fn(),
  publishAdminCatalogProductV2: vi.fn(),
}));
vi.mock("../../utils/apiClient", () => api);

function detailFixture() {
  return {
    product_id: "cat_coat",
    lifecycle_status: "published",
    version: 4,
    title: "Studio Coat",
    description: "A structured coat.",
    brand: "Sterling Hollis",
    category: "womens_apparel",
    metadata: { source: "catalog_studio" },
    published_snapshot: null,
    current_draft: {
      revision: { id: "draft_1", product_id: "cat_coat", base_version: 4, status: "draft", moderation_state: "approved", created_by: "user_1", created_at: "2026-06-17T12:00:00Z" },
      draft_version: 2,
      workflow_id: null,
      product: {
        product_id: "cat_coat",
        seed_run_id: "run_catalog",
        title: "Studio Coat",
        description: "A structured coat.",
        brand: "Sterling Hollis",
        category: "womens_apparel",
        metadata: { source: "catalog_studio" },
        design_specification: null,
        variant_axes: ["color"],
        primary_variant_index: 0,
        media: [],
        variants: [{
          variant_id: "var_black",
          color: "Black",
          material: "wool",
          gender: "women",
          season: "winter",
          price_min: 250,
          price_max: 250,
          link: null,
          image_link: "https://cdn.example/coat.jpg",
          image_set: {},
          metadata: {},
          inventory: [{ store_id: "1001", size: "M", availability: "in stock", inventory_qty: 8, objective_weight: 0.9, metadata: {} }],
        }],
      },
    },
    drafts: [],
  };
}

describe("ProductEditor", () => {
  beforeEach(() => {
    const fixture = detailFixture();
    api.getAdminCatalogProduct.mockReset().mockResolvedValue(fixture);
    api.getCatalogImageJob.mockReset();
    api.saveAdminCatalogProductDraft.mockReset().mockResolvedValue(fixture.current_draft.revision);
    api.startCatalogWorkflow.mockReset();
    api.startAdminCatalogProductRevision.mockReset();
    api.submitCatalogMediaCommand.mockReset();
    api.approveCatalogImageJob.mockReset();
    api.archiveAdminCatalogProduct.mockReset();
    api.publishAdminCatalogProduct.mockReset();
  });

  it("saves validated product, variant, price, and inventory data with draft versions", async () => {
    renderWithProviders(<ProductEditor productId="cat_coat" />);
    const title = await screen.findByLabelText("Product title");
    await userEvent.clear(title);
    await userEvent.type(title, "Updated Studio Coat");
    await userEvent.clear(screen.getByLabelText("Variant 1 inventory 1 quantity"));
    await userEvent.type(screen.getByLabelText("Variant 1 inventory 1 quantity"), "11");
    await userEvent.click(screen.getByRole("button", { name: /Save draft/i }));

    await waitFor(() => {
      expect(api.saveAdminCatalogProductDraft).toHaveBeenCalledWith(
        "cat_coat",
        expect.objectContaining({
          expected_version: 4,
          current_draft_id: "draft_1",
          expected_draft_version: 2,
          moderation_state: "approved",
          product: expect.objectContaining({
            title: "Updated Studio Coat",
            variants: [expect.objectContaining({
              price_min: 250,
              inventory: [expect.objectContaining({ inventory_qty: 11 })],
            })],
          }),
        }),
        "save-draft-key",
      );
    });
  });

  it("promotes existing imagery to core media without changing inventory", async () => {
    renderWithProviders(<ProductEditor productId="cat_coat" />);

    await screen.findByText("Images");
    await userEvent.click(screen.getByRole("button", { name: /Use current image as main/i }));

    await userEvent.click(screen.getByRole("button", { name: /Save draft/i }));
    await waitFor(() => expect(api.saveAdminCatalogProductDraft).toHaveBeenCalledWith(
      "cat_coat",
      expect.objectContaining({
        product: expect.objectContaining({
          media: [expect.objectContaining({ role: "core", approval_status: "approved" })],
          variants: [expect.objectContaining({ inventory: [expect.objectContaining({ inventory_qty: 8 })] })],
        }),
      }),
      "save-draft-key",
    ));
  });

  it("generates and approves a gallery view without creating sellable inventory", async () => {
    const fixture = detailFixture();
    fixture.current_draft.workflow_id = "workflow_1";
    fixture.current_draft.product.media = [{
      media_id: "media_core",
      role: "core",
      intent: "manual",
      source_media_id: null,
      parameters: {},
      image_set: { primary_url: "https://cdn.example/coat.jpg" },
      approval_status: "approved",
      display_order: 0,
      provenance: {},
    }];
    api.getAdminCatalogProduct.mockResolvedValue(fixture);
    api.submitCatalogMediaCommand.mockResolvedValue({
      id: "job_1",
      workflow_id: "workflow_1",
      status: "succeeded",
      intent: "scene",
    });
    api.approveCatalogImageJob.mockResolvedValue({ approval_status: "approved" });
    renderWithProviders(<ProductEditor productId="cat_coat" />);

    await userEvent.type(await screen.findByLabelText("Image variant instruction"), "bright living room");
    await userEvent.click(screen.getByRole("button", { name: /Generate image variant/i }));
    await waitFor(() => expect(api.submitCatalogMediaCommand).toHaveBeenCalledWith(
      "workflow_1",
      expect.objectContaining({
        source_media_id: "media_core",
        intent: "scene",
        parameters: { scene: "bright living room" },
      }),
      "media-variation-key",
    ));

    await userEvent.click(await screen.findByRole("button", { name: /Approve as new image/i }));
    await waitFor(() => expect(api.approveCatalogImageJob).toHaveBeenCalledWith(
      "workflow_1",
      "job_1",
      { draft_id: "draft_1", expected_draft_version: 2, approval_intent: "add" },
      "approve-media-key",
    ));
    expect(fixture.current_draft.product.variants).toHaveLength(1);
  });

  it("maps local validation to the relevant field and does not call the server", async () => {
    renderWithProviders(<ProductEditor productId="cat_coat" />);
    const title = await screen.findByLabelText("Product title");
    await userEvent.clear(title);
    await userEvent.click(screen.getByRole("button", { name: /Save draft/i }));

    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(api.saveAdminCatalogProductDraft).not.toHaveBeenCalled();
  });

  it("preserves local edits after a version conflict and offers an explicit reload", async () => {
    api.saveAdminCatalogProductDraft.mockRejectedValueOnce({ response: { status: 409 } });
    renderWithProviders(<ProductEditor productId="cat_coat" />);
    const title = await screen.findByLabelText("Product title");
    await userEvent.clear(title);
    await userEvent.type(title, "My Local Coat");
    await userEvent.click(screen.getByRole("button", { name: /Save draft/i }));

    expect(await screen.findByText("A newer server revision exists")).toBeInTheDocument();
    expect(screen.getByDisplayValue("My Local Coat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload server version/i })).toBeInTheDocument();
  });

  it("renders structured server validation errors", async () => {
    api.saveAdminCatalogProductDraft.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ loc: ["body", "product", "variants", 0, "inventory"], msg: "Invalid store" }] } },
    });
    renderWithProviders(<ProductEditor productId="cat_coat" />);
    const title = await screen.findByLabelText("Product title");
    await userEvent.clear(title);
    await userEvent.type(title, "Changed Coat");
    await userEvent.click(screen.getByRole("button", { name: /Save draft/i }));

    expect(await screen.findByText("product → variants → 0 → inventory: Invalid store")).toBeInTheDocument();
  });

  it("reuses a newly created revision when the first draft save must be retried", async () => {
    const fixture = detailFixture();
    fixture.current_draft = null;
    fixture.published_snapshot = detailFixture().current_draft.product;
    const createdDraft = detailFixture().current_draft;
    api.getAdminCatalogProduct.mockResolvedValue(fixture);
    api.startAdminCatalogProductRevision.mockResolvedValue(createdDraft);
    api.saveAdminCatalogProductDraft
      .mockRejectedValueOnce({ response: { status: 409 } })
      .mockResolvedValueOnce(createdDraft.revision);
    renderWithProviders(<ProductEditor productId="cat_coat" />);

    const title = await screen.findByLabelText("Product title");
    await userEvent.clear(title);
    await userEvent.type(title, "Retryable Coat");
    await userEvent.click(screen.getByRole("button", { name: /Save draft/i }));
    expect(await screen.findByText("A newer server revision exists")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Save draft/i }));
    await waitFor(() => expect(api.saveAdminCatalogProductDraft).toHaveBeenCalledTimes(2));
    expect(api.startAdminCatalogProductRevision).toHaveBeenCalledTimes(1);
  });
});
