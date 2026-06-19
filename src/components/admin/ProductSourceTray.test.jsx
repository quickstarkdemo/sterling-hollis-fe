import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductSourceTray from "./ProductSourceTray";

const api = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn((scope) => `${scope}-key`),
  deleteCatalogSourceAsset: vi.fn(),
  generateCatalogSuggestionSet: vi.fn(),
  getCatalogSourceBundles: vi.fn(),
  getCatalogSourcePreview: vi.fn(),
  promoteCatalogSourceAsset: vi.fn(),
  uploadCatalogSourceBundle: vi.fn(),
}));

vi.mock("../../utils/apiClient", () => api);

const draft = { revision: { id: "draft_one" }, draft_version: 2 };
const asset = (overrides = {}) => ({
  id: "asset_one",
  display_order: 0,
  original_filename: "front.jpg",
  content_type: "image/jpeg",
  byte_size: 2048,
  width: 1200,
  height: 1600,
  status: "ready",
  preview_url: "/api/admin/catalog/source-bundles/bundle_one/assets/asset_one/preview",
  ...overrides,
});
const bundle = (assets = [asset()]) => ({
  id: "bundle_one",
  title: "Supplier handoff",
  catalog_product_id: "cat_one",
  draft_revision_id: "draft_one",
  assets,
});

function renderTray(props = {}) {
  return renderWithProviders(<ProductSourceTray productId="cat_one" draft={draft} {...props} />);
}

describe("ProductSourceTray", () => {
  beforeEach(() => {
    api.getCatalogSourceBundles.mockReset().mockResolvedValue({ items: [] });
    api.getCatalogSourcePreview.mockReset().mockRejectedValue(new Error("preview unavailable in test"));
    api.uploadCatalogSourceBundle.mockReset();
    api.deleteCatalogSourceAsset.mockReset().mockResolvedValue(undefined);
    api.promoteCatalogSourceAsset.mockReset();
    api.generateCatalogSuggestionSet.mockReset();
  });

  it("preserves selected file order and uploads one private bundle", async () => {
    const files = [
      new File(["front"], "front.jpg", { type: "image/jpeg" }),
      new File(["detail"], "detail.png", { type: "image/png" }),
    ];
    api.uploadCatalogSourceBundle.mockResolvedValue(bundle([
      asset(),
      asset({ id: "asset_two", display_order: 1, original_filename: "detail.png" }),
    ]));
    const { container } = renderTray();
    const input = container.querySelector('input[type="file"]');

    await userEvent.upload(input, files);
    expect(screen.getByText("1. front.jpg")).toBeInTheDocument();
    expect(screen.getByText("2. detail.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Upload sources" }));

    await waitFor(() => expect(api.uploadCatalogSourceBundle).toHaveBeenCalled());
    expect(api.uploadCatalogSourceBundle.mock.calls[0][0]).toEqual(files);
    expect(api.uploadCatalogSourceBundle.mock.calls[0][1]).toEqual(expect.objectContaining({
      catalogProductId: "cat_one",
      draftRevisionId: "draft_one",
    }));
    expect(await screen.findByText("2 supplier images uploaded privately.")).toBeInTheDocument();
  });

  it("keeps client and server validation attached to selected files", async () => {
    const invalid = new File(["gif"], "supplier.gif", { type: "image/gif" });
    const { container } = renderTray();
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [invalid] } });

    expect(screen.getByText("Use a JPEG, PNG, or WebP image.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload sources" })).toBeDisabled();

    const valid = new File(["front"], "front.jpg", { type: "image/jpeg" });
    api.uploadCatalogSourceBundle.mockRejectedValueOnce({ response: { data: { detail: "Image dimensions exceed the safe limit." } } });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [valid] } });
    await userEvent.click(screen.getByRole("button", { name: "Upload sources" }));
    expect(await screen.findAllByText("Image dimensions exceed the safe limit.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Upload sources" })).toBeEnabled();
  });

  it("supports promotion and supplier analysis", async () => {
    api.getCatalogSourceBundles.mockResolvedValue({ items: [bundle()] });
    api.promoteCatalogSourceAsset.mockResolvedValue({ asset: asset({ status: "promoted", promoted_media_id: "media_one" }), draft: { id: "draft_two" } });
    api.generateCatalogSuggestionSet.mockResolvedValue({
      message: "Suggestions ready.",
      suggestion_set: { id: "set_one" },
      follow_up_questions: [{ target_path: "/specifications", question: "What are the exact dimensions?" }],
    });
    const ensureWorkflow = vi.fn().mockResolvedValue("workflow_one");
    const onDraftChanged = vi.fn();
    const onSuggestionsChanged = vi.fn();
    renderTray({ ensureWorkflow, onDraftChanged, onSuggestionsChanged });

    expect(await screen.findByText("front.jpg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Generate suggestions from sources" }));
    expect(api.generateCatalogSuggestionSet).toHaveBeenCalledWith("cat_one", expect.objectContaining({
      source_asset_ids: ["asset_one"],
      input_origin: "supplier_analysis",
    }), "supplier-analysis-key");
    expect(await screen.findByText("What are the exact dimensions?")).toBeInTheDocument();
    expect(onSuggestionsChanged).toHaveBeenCalledWith({ id: "set_one" });

    await userEvent.click(screen.getByRole("button", { name: "Promote to media" }));
    expect(api.promoteCatalogSourceAsset).toHaveBeenCalledWith("bundle_one", "asset_one", {
      draft_id: "draft_one", expected_draft_version: 2,
    }, "promote-source-asset_one-key");
    expect(onDraftChanged).toHaveBeenCalled();
  });

  it("removes an unattached private source without changing the draft", async () => {
    api.getCatalogSourceBundles.mockResolvedValue({ items: [bundle()] });
    const onDraftChanged = vi.fn();
    renderTray({ onDraftChanged });

    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(api.deleteCatalogSourceAsset).toHaveBeenCalledWith("bundle_one", "asset_one");
    expect(await screen.findByText("front.jpg removed from private sources.")).toBeInTheDocument();
    expect(onDraftChanged).not.toHaveBeenCalled();
  });

  it("accepts dropped files without changing their order", async () => {
    const dropped = [
      new File(["a"], "angle.webp", { type: "image/webp" }),
      new File(["b"], "back.jpg", { type: "image/jpeg" }),
    ];
    renderTray();
    await screen.findByText("No supplier images are attached to this product yet.");
    const zone = screen.getByRole("button", { name: "Upload supplier images" });
    fireEvent.drop(zone, { dataTransfer: { files: dropped } });
    expect(screen.getByText("1. angle.webp")).toBeInTheDocument();
    expect(screen.getByText("2. back.jpg")).toBeInTheDocument();
  });
});
