export function money(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function titleize(value) {
  return String(value || "")
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function imageFor(product) {
  return product?.images?.thumbnail_url || product?.images?.primary_url || product?.image_url || "";
}

export function detailImages(product) {
  const mediaUrls = [...(product?.media || [])]
    .sort((left, right) => Number(left.display_order || 0) - Number(right.display_order || 0))
    .flatMap((asset) => [
      asset?.images?.primary_url,
      ...(asset?.images?.detail_urls || []),
      asset?.images?.thumbnail_url,
    ])
    .filter(Boolean);
  if (mediaUrls.length) return Array.from(new Set(mediaUrls));
  const urls = [
    product?.images?.primary_url,
    ...(product?.images?.detail_urls || []),
    product?.image_url,
  ].filter(Boolean);
  return Array.from(new Set(urls));
}

export function inventoryByStore(product) {
  const stores = new Map();
  (product?.inventory || []).forEach((row) => {
    const storeId = row.store_id || "Store";
    const current = stores.get(storeId) || { storeId, units: 0, sizes: new Set(), availability: new Set() };
    current.units += Number(row.inventory_qty || 0);
    if (row.size) current.sizes.add(row.size);
    current.availability.add(String(row.stock_state || row.availability || "unknown").trim().toLowerCase().replace(/\s+/g, "_"));
    stores.set(storeId, current);
  });
  return [...stores.values()].map((store) => ({
    storeId: store.storeId,
    units: store.units,
    sizes: [...store.sizes],
    availability: store.availability.has("in_stock")
      ? "in_stock"
      : store.availability.has("preorder") ? "preorder" : [...store.availability][0],
  }));
}
