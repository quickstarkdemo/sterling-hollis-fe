import { describe, expect, it } from "vitest";

import { inventoryByStore } from "./format";

describe("inventoryByStore", () => {
  it("groups sizes and units by store with deterministic availability precedence", () => {
    expect(inventoryByStore({
      inventory: [
        { store_id: "1001", size: "M", inventory_qty: 3, stock_state: "in_stock" },
        { store_id: "1001", size: "L", inventory_qty: 2, availability: "preorder" },
        { store_id: "1002", size: null, inventory_qty: 4, availability: "preorder" },
        { store_id: "1003", size: "One Size", inventory_qty: 0, availability: "out_of_stock" },
      ],
    })).toEqual([
      { storeId: "1001", units: 5, sizes: ["M", "L"], availability: "in_stock" },
      { storeId: "1002", units: 4, sizes: [], availability: "preorder" },
      { storeId: "1003", units: 0, sizes: ["One Size"], availability: "out_of_stock" },
    ]);
  });

  it("returns no store cards when product inventory is absent", () => {
    expect(inventoryByStore(null)).toEqual([]);
    expect(inventoryByStore({})).toEqual([]);
  });
});
