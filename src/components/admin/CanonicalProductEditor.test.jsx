import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductEditor from "./ProductEditor";

const api = vi.hoisted(() => ({
  approveCatalogImageJob: vi.fn(),
  archiveAdminCatalogProduct: vi.fn(),
  archiveAdminCatalogProductCurrentV2: vi.fn(),
  createAdminCatalogBrand: vi.fn(),
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  getAdminCatalogProduct: vi.fn(),
  getAdminCatalogProductCompatibilityV2: vi.fn(),
  getAdminCatalogProductV3: vi.fn(),
  getAdminCatalogProductPreviewV3: vi.fn(),
  getAdminCatalogProductReadinessV3: vi.fn(),
  getCatalogImageJob: vi.fn(),
  publishAdminCatalogProduct: vi.fn(),
  publishAdminCatalogProductCompatibilityV2: vi.fn(),
  publishAdminCatalogProductV3: vi.fn(),
  saveAdminCatalogProductDraft: vi.fn(),
  saveAdminCatalogProductDraftCompatibilityV2: vi.fn(),
  saveAdminCatalogProductDraftV3: vi.fn(),
  startAdminCatalogProductRevision: vi.fn(),
  startAdminCatalogProductRevisionCompatibilityV2: vi.fn(),
  startAdminCatalogProductRevisionV3: vi.fn(),
  startCatalogWorkflow: vi.fn(),
  submitCatalogMediaCommand: vi.fn(),
}));
vi.mock("../../utils/apiClient", () => api);

const references = {
  brands: [
    { id: "brand_august", name: "August & Mercer" },
    { id: "brand_sterling", name: "Sterling Hollis" },
  ],
  stores: [
    { id: "1001", name: "Dallas Downtown", city: "Dallas", state: "TX", label: "Dallas Downtown — Dallas, TX" },
    { id: "1002", name: "Oak Brook", city: "Oak Brook", state: "IL", label: "Oak Brook — Oak Brook, IL" },
  ],
  categories: [{ id: "home", label: "Home" }],
  availability: [{ id: "in stock", label: "In stock" }, { id: "out of stock", label: "Out of stock" }],
};

function canonicalDetail() {
  const product = {
    schema_version: 2,
    product_id: "cat_pillow",
    seed_run_id: "run_catalog",
    title: "August & Mercer Black Pillow",
    description: "A substantial black linen pillow.",
    brand_id: "brand_august",
    brand: "August & Mercer",
    category: "home",
    price_min: 88,
    price_max: 88,
    link: "https://example.com/pillow",
    color: "Black",
    material: "Linen",
    gender: null,
    season: "All season",
    metadata: { source: "catalog_studio" },
    media: [
      { media_id: "media_main", role: "core", intent: "manual", source_media_id: null, predecessor_media_id: null, parameters: {}, image_set: { primary_url: "https://example.com/main.jpg" }, approval_status: "approved", display_order: 0, provenance: {} },
      { media_id: "media_detail", role: "variation", intent: "angle", source_media_id: "media_main", predecessor_media_id: null, parameters: {}, image_set: { primary_url: "https://example.com/detail.jpg" }, approval_status: "approved", display_order: 1, provenance: {} },
    ],
    inventory: [{ store_id: "1001", size: null, availability: "in stock", inventory_qty: 8, metadata: {} }],
  };
  return {
    product_id: "cat_pillow",
    lifecycle_status: "published",
    version: 5,
    title: product.title,
    description: product.description,
    brand: product.brand,
    category: product.category,
    metadata: product.metadata,
    published_snapshot: null,
    current_draft: {
      revision: { id: "draft_2", moderation_state: "approved" },
      draft_version: 3,
      workflow_id: "workflow_2",
      product,
    },
    drafts: [],
  };
}

describe("ProductEditor v2 merchandiser workflow", () => {
  beforeEach(() => {
    const fixture = canonicalDetail();
    api.getAdminCatalogProductCompatibilityV2.mockReset().mockResolvedValue(fixture);
    api.saveAdminCatalogProductDraftCompatibilityV2.mockReset().mockResolvedValue(fixture.current_draft.revision);
    api.createAdminCatalogBrand.mockReset();
    api.submitCatalogMediaCommand.mockReset();
    api.approveCatalogImageJob.mockReset();
  });

  it("renders product details, every image, and named-store inventory without commerce variants or internal fields", async () => {
    renderWithProviders(<ProductEditor productId="cat_pillow" authoringSchemaVersion={2} references={references} referencesStatus="ready" />);

    expect(await screen.findByText("Product details")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Main image" })).toHaveAttribute("src", "https://example.com/main.jpg");
    expect(screen.getByRole("img", { name: "angle image variant 2" })).toHaveAttribute("src", "https://example.com/detail.jpg");
    expect(screen.getByLabelText("Inventory 1 store")).toHaveDisplayValue("Dallas Downtown — Dallas, TX");
    expect(screen.queryByText(/Sellable options/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Variant 1$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Seed run ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Product metadata JSON")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/weight/i)).not.toBeInTheDocument();
  });

  it("saves customer-facing product fields and inventory through the v2 draft contract", async () => {
    renderWithProviders(<ProductEditor productId="cat_pillow" authoringSchemaVersion={2} references={references} referencesStatus="ready" />);
    const title = await screen.findByLabelText("Product title");
    fireEvent.change(title, { target: { value: "August & Mercer Midnight Pillow" } });
    fireEvent.change(screen.getByLabelText("Inventory 1 quantity"), { target: { value: "12" } });
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(api.saveAdminCatalogProductDraftCompatibilityV2).toHaveBeenCalledWith(
      "cat_pillow",
      expect.objectContaining({
        expected_version: 5,
        current_draft_id: "draft_2",
        expected_draft_version: 3,
        product: expect.objectContaining({
          schema_version: 2,
          title: "August & Mercer Midnight Pillow",
          brand_id: "brand_august",
          price_min: 88,
          inventory: [expect.objectContaining({ store_id: "1001", inventory_qty: 12 })],
        }),
      }),
      "save-v2-draft-key",
    ));
    expect(api.saveAdminCatalogProductDraft).not.toHaveBeenCalled();
  });

  it("maps duplicate store and size combinations to the affected inventory row", async () => {
    renderWithProviders(<ProductEditor productId="cat_pillow" authoringSchemaVersion={2} references={references} referencesStatus="ready" />);
    await screen.findByText("Store inventory");
    await userEvent.click(screen.getByRole("button", { name: "Add inventory row" }));
    await userEvent.selectOptions(screen.getByLabelText("Inventory 2 store"), "1001");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText("This store and size combination is already listed.")).toBeInTheDocument();
    expect(api.saveAdminCatalogProductDraftCompatibilityV2).not.toHaveBeenCalled();
  });

  it("preserves product edits while approving a generated image candidate", async () => {
    const initial = canonicalDetail();
    const afterApproval = canonicalDetail();
    afterApproval.current_draft.product.media.push({
      media_id: "media_scene",
      role: "variation",
      intent: "scene",
      source_media_id: "media_main",
      predecessor_media_id: null,
      parameters: { scene: "sunlit room" },
      image_set: { primary_url: "https://example.com/scene.jpg" },
      approval_status: "approved",
      display_order: 2,
      provenance: {},
    });
    api.getAdminCatalogProductCompatibilityV2.mockReset()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(afterApproval);
    api.submitCatalogMediaCommand.mockResolvedValue({
      id: "job_scene",
      workflow_id: "workflow_2",
      source_media_id: "media_main",
      status: "succeeded",
      intent: "scene",
    });
    api.approveCatalogImageJob.mockResolvedValue({ approval_status: "approved" });
    renderWithProviders(<ProductEditor productId="cat_pillow" authoringSchemaVersion={2} references={references} referencesStatus="ready" />);

    await userEvent.type(await screen.findByLabelText("Image variant instruction"), "sunlit room");
    await userEvent.click(screen.getByRole("button", { name: "Generate image variant" }));
    const title = await screen.findByLabelText("Product title");
    fireEvent.change(title, { target: { value: "Locally Edited Pillow" } });
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();

    await userEvent.click(await screen.findByRole("button", { name: "Approve as new image" }));

    await waitFor(() => expect(api.approveCatalogImageJob).toHaveBeenCalledWith(
      "workflow_2",
      "job_scene",
      { draft_id: "draft_2", expected_draft_version: 3, approval_intent: "add" },
      "approve-media-key",
    ));
    expect(screen.getByDisplayValue("Locally Edited Pillow")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "scene image variant 3" })).toHaveAttribute("src", "https://example.com/scene.jpg");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });
});

describe("ProductEditor v3 structured authoring", () => {
  beforeEach(() => {
    const fixture = canonicalDetail();
    fixture.current_draft.product = {
      ...fixture.current_draft.product,
      schema_version: 3,
      benefits: ["Comfortable texture"],
      specifications: [{ name: "material", value: "Linen" }],
      care_instructions: ["Spot clean"],
      content_details: ["Knife-edge finish"],
      seo: { title: "Black linen pillow", description: "A substantial black linen pillow.", keywords: ["linen pillow"] },
      source_references: [],
      readiness_inputs: { required_specifications: ["material"] },
      media: fixture.current_draft.product.media.map((item) => ({ ...item, alt_text: "Black linen pillow" })),
    };
    fixture.current_draft.readiness = { ready: false, blocking_errors: [{ code: "blocked", field_path: "/media", message: "Approve all media." }], recommendations: [] };
    api.getAdminCatalogProductV3.mockReset().mockResolvedValue(fixture);
    api.saveAdminCatalogProductDraftCompatibilityV2.mockReset();
    api.saveAdminCatalogProductDraftV3.mockReset().mockResolvedValue(fixture.current_draft.revision);
    api.getAdminCatalogProductReadinessV3.mockReset().mockResolvedValue(fixture.current_draft.readiness);
    api.getAdminCatalogProductPreviewV3.mockReset().mockResolvedValue({ draft_version: 3, preview: fixture.current_draft.product, readiness: fixture.current_draft.readiness });
  });

  it("saves structured copy through v3 and renders canonical preview plus readiness", async () => {
    renderWithProviders(<ProductEditor productId="cat_pillow" authoringSchemaVersion={3} references={references} referencesStatus="ready" />);

    const benefits = await screen.findByLabelText("Product benefits");
    fireEvent.change(benefits, { target: { value: "Comfortable texture\nLayer-friendly styling" } });
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(api.saveAdminCatalogProductDraftV3).toHaveBeenCalledWith(
      "cat_pillow",
      expect.objectContaining({
        product: expect.objectContaining({
          schema_version: 3,
          benefits: ["Comfortable texture", "Layer-friendly styling"],
          specifications: [{ name: "material", value: "Linen" }],
          seo: expect.objectContaining({ title: "Black linen pillow" }),
        }),
      }),
      "save-v3-draft-key",
    ));
    expect(api.saveAdminCatalogProductDraftCompatibilityV2).not.toHaveBeenCalled();
    expect(screen.getByText("Canonical storefront projection")).toBeInTheDocument();
    expect(screen.getByText("Approve all media.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish draft/i })).toBeDisabled();
  });
});
