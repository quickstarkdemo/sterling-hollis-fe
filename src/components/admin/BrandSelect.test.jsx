import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import BrandSelect from "./BrandSelect";

const brands = [
  { id: "brand_august", name: "August & Mercer" },
  { id: "brand_sterling", name: "Sterling Hollis" },
];

describe("BrandSelect", () => {
  it("filters canonical brands and returns the selected reference", async () => {
    const onChange = vi.fn();
    renderWithProviders(<BrandSelect brandId="brand_sterling" brandName="Sterling Hollis" brands={brands} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("Search brands"), "August");
    expect(screen.getByRole("option", { name: "Sterling Hollis" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Product brand"), "brand_august");

    expect(onChange).toHaveBeenCalledWith(brands[0]);
  });

  it("adds and selects a new canonical brand from an accessible dialog", async () => {
    const created = { id: "brand_new", name: "New Atelier" };
    const onChange = vi.fn();
    const onCreate = vi.fn().mockResolvedValue(created);
    renderWithProviders(<BrandSelect brands={brands} onChange={onChange} onCreate={onCreate} />);

    await userEvent.click(screen.getByRole("button", { name: "Add brand" }));
    expect(screen.getByRole("dialog", { name: "Add a canonical brand" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("New brand name"), "New Atelier");
    await userEvent.click(screen.getByRole("button", { name: "Add brand" }));

    expect(onCreate).toHaveBeenCalledWith("New Atelier");
    expect(onChange).toHaveBeenCalledWith(created);
  });

  it("preserves the current value and exposes retry when references fail", () => {
    const onRetry = vi.fn();
    renderWithProviders(<BrandSelect brandId="brand_sterling" brandName="Sterling Hollis" brands={[]} status="error" onRetry={onRetry} />);

    expect(screen.getByLabelText("Product brand")).toHaveDisplayValue("Sterling Hollis");
    expect(screen.getByText(/current value is preserved/i)).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalled();
  });
});
