import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductMediaEditor from "./ProductMediaEditor";

const core = {
  media_id: "media_core",
  role: "core",
  intent: "manual",
  source_media_id: null,
  parameters: {},
  image_set: { primary_url: "https://example.com/core.jpg" },
  approval_status: "approved",
  display_order: 0,
  provenance: {},
};

describe("ProductMediaEditor", () => {
  it("promotes the current image to core media without inventory fields", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ProductMediaEditor fallbackCoreUrl="https://example.com/current.jpg" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /Use current image as main/i }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ role: "core", intent: "manual", approval_status: "approved" }),
    ]);
    expect(screen.getByText(/Image variants never change price or inventory/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/price/i)).not.toBeInTheDocument();
  });

  it("submits a typed media variation from the core asset", async () => {
    const onGenerate = vi.fn();
    renderWithProviders(<ProductMediaEditor media={[core]} onGenerate={onGenerate} />);

    await userEvent.selectOptions(screen.getByLabelText("Image variant intent"), "scene");
    await userEvent.type(screen.getByLabelText("Image variant instruction"), "Bright living room");
    await userEvent.click(screen.getByRole("button", { name: "Generate image variant" }));

    expect(onGenerate).toHaveBeenCalledWith({
      source_media_id: "media_core",
      intent: "scene",
      parameters: { scene: "Bright living room" },
      instruction: undefined,
    });
  });

  it("supports source selection, set main, removal, and undo for every approved image", async () => {
    const onChange = vi.fn();
    const media = [
      core,
      {
        ...core,
        media_id: "media_color",
        role: "variation",
        intent: "color",
        source_media_id: "media_core",
        display_order: 1,
      },
    ];
    renderWithProviders(<ProductMediaEditor media={media} onChange={onChange} />);

    expect(screen.getByText("color image variant 2")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Use as source" })[0]);
    expect(screen.getByText("Source: color image variant 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set main" }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ media_id: "media_color", role: "core", display_order: 0 }),
      expect.objectContaining({ media_id: "media_core", role: "variation", display_order: 1 }),
    ]);

    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ media_id: "media_core" })]);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("offers explicit add and replacement approval intents beside the source job", async () => {
    const onApprove = vi.fn();
    renderWithProviders(<ProductMediaEditor media={[core]} job={{ status: "succeeded", source_media_id: "media_core", intent: "scene" }} onApprove={onApprove} />);

    await userEvent.click(screen.getByRole("button", { name: "Approve as new image" }));
    expect(onApprove).toHaveBeenCalledWith({ approval_intent: "add" });
    await userEvent.click(screen.getByRole("button", { name: "Replace this image" }));
    expect(onApprove).toHaveBeenCalledWith({ approval_intent: "replace", replace_media_id: "media_core" });
  });

  it("locks destructive gallery actions while an image candidate is active", () => {
    renderWithProviders(<ProductMediaEditor media={[core, { ...core, media_id: "media_detail", role: "variation", display_order: 1 }]} job={{ status: "running", source_media_id: "media_detail", intent: "scene" }} mutationsDisabled />);

    expect(screen.getByRole("button", { name: "Set main" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Remove" })[1]).toBeDisabled();
    expect(screen.getByText(/Finish this image candidate/i)).toBeInTheDocument();
  });
});
