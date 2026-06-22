const LABELS = {
  "catalog_admin.assistant.query": "Catalog assistant query",
  "catalog_admin.catalog.manage": "Catalog management",
  "catalog_admin.product.draft": "Catalog draft",
  "catalog_admin.product.publish": "Catalog publication",
  "developer_trace.read": "Developer trace",
  "public.catalog.product_detail": "Product detail",
  "public.catalog.recommendations": "Product recommendations",
  "public.catalog.search": "Catalog search",
  "shopper.chat.turn": "Shopper chat",
};

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

export function capabilityLabel(capabilityId, fallback = "Capability") {
  if (!capabilityId) return fallback;
  return LABELS[capabilityId] || String(capabilityId).split(".").map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1).replace(/_/g, " ")
  )).join(" / ");
}

export function normalizeCapabilityDiagnostic(input = {}, fallback = {}) {
  const metadata = input.capability_metadata || input.capability || input.metadata || {};
  const attributes = input.attributes || {};
  const capabilityId = firstValue(
    input.capability_id,
    input.capabilityId,
    metadata.capability_id,
    metadata.capabilityId,
    attributes.capability_id,
    fallback.capabilityId,
  );
  const surface = firstValue(
    input.surface,
    metadata.surface,
    metadata.api_surface,
    metadata.capability_surface,
    attributes.surface,
    attributes.api_surface,
    fallback.surface,
  );
  const status = firstValue(input.status, input.decision, metadata.status, attributes.status, fallback.status);
  const operation = firstValue(input.operation, input.name, metadata.operation, attributes.operation, fallback.operation);
  return {
    capabilityId: capabilityId || "",
    label: capabilityLabel(capabilityId, operation || fallback.label || "Capability"),
    operation: operation || "",
    persona: firstValue(input.persona, metadata.persona, attributes.persona, fallback.persona) || "",
    sideEffect: firstValue(input.side_effect, metadata.side_effect, attributes.side_effect, fallback.sideEffect) || "",
    status: status || "",
    surface: surface || "",
  };
}

export function capabilityDiagnosticParts(input, fallback) {
  const diagnostic = normalizeCapabilityDiagnostic(input, fallback);
  return [
    diagnostic.label,
    diagnostic.surface,
    diagnostic.status,
  ].filter(Boolean);
}
