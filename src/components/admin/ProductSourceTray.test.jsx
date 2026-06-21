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
  asset_kind: "image",
  content_type: "image/jpeg",
  byte_size: 2048,
  width: 1200,
  height: 1600,
  status: "ready",
  preview_url: "/api/admin/catalog/source-bundles/bundle_one/assets/asset_one/preview",
  ...overrides,
});
const bundle = (assets = [asset()], overrides = {}) => ({
  id: "bundle_one",
  title: "Supplier handoff",
  catalog_product_id: "cat_one",
  draft_revision_id: "draft_one",
  assets,
  rejected_assets: [],
  ...overrides,
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

  it("preserves mixed selected file order and uploads one private bundle", async () => {
    const files = [
      new File(["front"], "front.jpg", { type: "image/jpeg" }),
      new File(["specs"], "specs.txt", { type: "text/plain" }),
      new File(["fit"], "fit.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    ];
    api.uploadCatalogSourceBundle.mockResolvedValue(bundle([
      asset(),
      asset({
        id: "asset_two",
        display_order: 1,
        original_filename: "specs.txt",
        asset_kind: "document",
        content_type: "text/plain",
        width: 1,
        height: 1,
      }),
      asset({
        id: "asset_three",
        display_order: 2,
        original_filename: "fit.docx",
        asset_kind: "document",
        content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        width: 1,
        height: 1,
      }),
    ]));
    const { container } = renderTray();
    const input = container.querySelector('input[type="file"]');

    await userEvent.upload(input, files);
    expect(screen.getByText("1. front.jpg")).toBeInTheDocument();
    expect(screen.getByText("2. specs.txt")).toBeInTheDocument();
    expect(screen.getByText("3. fit.docx")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Upload sources" }));

    await waitFor(() => expect(api.uploadCatalogSourceBundle).toHaveBeenCalled());
    expect(api.uploadCatalogSourceBundle.mock.calls[0][0]).toEqual(files);
    expect(api.uploadCatalogSourceBundle.mock.calls[0][1]).toEqual(expect.objectContaining({
      catalogProductId: "cat_one",
      draftRevisionId: "draft_one",
    }));
    expect(await screen.findByText("3 supplier sources uploaded privately.")).toBeInTheDocument();
    expect(await screen.findByText("specs.txt")).toBeInTheDocument();
    expect(screen.getAllByText("Evidence only")).toHaveLength(2);
  });

  it("keeps invalid siblings attached while valid files upload", async () => {
    const invalid = new File(["gif"], "supplier.gif", { type: "image/gif" });
    const valid = new File(["front"], "front.jpg", { type: "image/jpeg" });
    api.uploadCatalogSourceBundle.mockResolvedValue(bundle());
    const { container } = renderTray();
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [invalid, valid] } });

    expect(screen.getByText("Use JPEG, PNG, WebP, TXT, PDF, or DOCX.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload sources" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Upload sources" }));
    expect(api.uploadCatalogSourceBundle.mock.calls[0][0]).toEqual([valid]);
    expect(await screen.findByText(/supplier\.gif/)).toBeInTheDocument();
    expect(screen.getByText("1 supplier source uploaded privately.")).toBeInTheDocument();
  });

  it("keeps server partial rejections attached to selected files", async () => {
    const valid = new File(["front"], "front.jpg", { type: "image/jpeg" });
    api.uploadCatalogSourceBundle.mockResolvedValueOnce(bundle([asset()], {
      rejected_assets: [
        {
          original_filename: "spoofed.pdf",
          content_type: "application/pdf",
          reason: "PDF document appears to be malformed.",
        },
      ],
    }));
    const { container } = renderTray();
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [valid] } });
    await userEvent.click(screen.getByRole("button", { name: "Upload sources" }));

    expect(await screen.findByText(/spoofed\.pdf/)).toBeInTheDocument();
    expect(screen.getByText("PDF document appears to be malformed.")).toBeInTheDocument();
    expect(screen.getByText("1 supplier source uploaded privately. 1 file needs attention.")).toBeInTheDocument();
  });

  it("keeps server validation attached when the whole upload fails", async () => {
    const valid = new File(["front"], "front.jpg", { type: "image/jpeg" });
    api.uploadCatalogSourceBundle
      .mockRejectedValueOnce({ response: { data: { detail: "Image dimensions exceed the safe limit." } } })
      .mockResolvedValueOnce(bundle());
    const { container } = renderTray();
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [valid] } });
    await userEvent.click(screen.getByRole("button", { name: "Upload sources" }));
    expect(await screen.findAllByText("Image dimensions exceed the safe limit.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Upload sources" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Upload sources" }));
    expect(await screen.findByText("1 supplier source uploaded privately.")).toBeInTheDocument();
    expect(screen.queryByText("Image dimensions exceed the safe limit.")).not.toBeInTheDocument();
  });

  it("supports promotion and supplier analysis", async () => {
    api.getCatalogSourceBundles.mockResolvedValue({ items: [bundle([
      asset(),
      asset({
        id: "asset_doc",
        display_order: 1,
        original_filename: "specs.txt",
        asset_kind: "document",
        content_type: "text/plain",
        width: 1,
        height: 1,
      }),
    ])] });
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
      source_asset_ids: ["asset_one", "asset_doc"],
      input_origin: "supplier_analysis",
    }), "supplier-analysis-key");
    expect(await screen.findByText("What are the exact dimensions?")).toBeInTheDocument();
    expect(onSuggestionsChanged).toHaveBeenCalledWith({ id: "set_one" });

    expect(screen.getByText("Evidence only")).toBeInTheDocument();
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
    await screen.findByText("No supplier sources are attached to this product yet.");
    const zone = screen.getByRole("button", { name: "Upload supplier product package" });
    fireEvent.drop(zone, { dataTransfer: { files: dropped } });
    expect(screen.getByText("1. angle.webp")).toBeInTheDocument();
    expect(screen.getByText("2. back.jpg")).toBeInTheDocument();
  });
});
