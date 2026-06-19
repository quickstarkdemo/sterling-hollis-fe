import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductInventoryEditor from "./ProductInventoryEditor";

const stores = [
  { id: "1001", name: "Dallas Downtown", city: "Dallas", state: "TX", label: "Dallas Downtown — Dallas, TX" },
  { id: "1002", name: "Oak Brook", city: "Oak Brook", state: "IL", label: "Oak Brook — Oak Brook, IL" },
];
const availability = [
  { id: "in stock", label: "In stock" },
  { id: "out of stock", label: "Out of stock" },
];
const inventory = [
  { store_id: "1001", size: null, availability: "in stock", inventory_qty: 8, metadata: {} },
  { store_id: "1002", size: "M", availability: "out of stock", inventory_qty: 0, metadata: {} },
];

describe("ProductInventoryEditor", () => {
  it("edits named-store inventory without technical weighting fields", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState(inventory);
      return <ProductInventoryEditor inventory={value} stores={stores} availability={availability} onChange={(next) => { setValue(next); onChange(next); }} />;
    }
    renderWithProviders(<Harness />);

    expect(screen.getByLabelText("Inventory 1 store")).toHaveDisplayValue("Dallas Downtown — Dallas, TX");
    expect(screen.queryByLabelText(/weight/i)).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Inventory 1 quantity"));
    await userEvent.type(screen.getByLabelText("Inventory 1 quantity"), "12");
    await userEvent.type(screen.getByLabelText("Inventory 1 size"), "Extra large");

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ store_id: "1001", inventory_qty: "12", size: "Extra large" }),
      inventory[1],
    ]);
  });

  it("removes and restores an inventory row before publication", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState(inventory);
      return <ProductInventoryEditor inventory={value} stores={stores} availability={availability} onChange={(next) => { setValue(next); onChange(next); }} />;
    }
    renderWithProviders(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Remove inventory for Oak Brook — Oak Brook, IL" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onChange).toHaveBeenLastCalledWith(inventory);
  });

  it("disables dependent inventory actions while references are unavailable", () => {
    renderWithProviders(<ProductInventoryEditor inventory={[inventory[0]]} stores={[]} availability={[]} referencesReady={false} onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Add inventory row" })).toBeDisabled();
    expect(screen.getByLabelText("Inventory 1 store")).toBeDisabled();
    expect(screen.getByText(/choices must load/i)).toBeInTheDocument();
  });
});
