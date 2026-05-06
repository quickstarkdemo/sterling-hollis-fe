export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";
export const CLERK_ENABLED = Boolean(CLERK_PUBLISHABLE_KEY);

const DEMO_OBSERVABILITY_UI_RUNTIME_PLACEHOLDER = "__VITE_DEMO_OBSERVABILITY_UI__";

function isTruthyEnvValue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function isDemoObservabilityUiEnabled() {
  return [import.meta.env.VITE_DEMO_OBSERVABILITY_UI, DEMO_OBSERVABILITY_UI_RUNTIME_PLACEHOLDER].some(
    isTruthyEnvValue,
  );
}
