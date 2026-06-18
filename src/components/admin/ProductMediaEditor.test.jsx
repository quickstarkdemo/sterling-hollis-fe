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

    await userEvent.click(screen.getByRole("button", { name: /Use current image as core/i }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ role: "core", intent: "manual", approval_status: "approved" }),
    ]);
    expect(screen.getByText(/Core and generated gallery views do not create sellable options or inventory/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/price/i)).not.toBeInTheDocument();
  });

  it("submits a typed media variation from the core asset", async () => {
    const onGenerate = vi.fn();
    renderWithProviders(<ProductMediaEditor media={[core]} onGenerate={onGenerate} />);

    await userEvent.selectOptions(screen.getByLabelText("Image variation intent"), "scene");
    await userEvent.type(screen.getByLabelText("Image variation instruction"), "Bright living room");
    await userEvent.click(screen.getByRole("button", { name: "Generate variation" }));

    expect(onGenerate).toHaveBeenCalledWith({
      source_media_id: "media_core",
      intent: "scene",
      parameters: { scene: "Bright living room" },
      instruction: undefined,
    });
  });

  it("labels visual colors as gallery views rather than purchasable options", () => {
    renderWithProviders(<ProductMediaEditor media={[
      core,
      {
        ...core,
        media_id: "media_color",
        role: "variation",
        intent: "color",
        source_media_id: "media_core",
        display_order: 1,
      },
    ]} />);

    expect(screen.getByText("color view")).toBeInTheDocument();
    expect(screen.getAllByText("Gallery view, not a purchasable option")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Move manual view down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move color view up" })).toBeDisabled();
  });
});
