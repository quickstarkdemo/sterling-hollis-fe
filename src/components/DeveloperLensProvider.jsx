import { useCallback, useMemo, useState } from "react";

import { DeveloperLensContext } from "./DeveloperLensContext";

const STORAGE_KEY = "sterling-hollis:catalog-studio:developer-lens";

function initialPreference() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "enabled";
  } catch {
    return false;
  }
}

function persistPreference(enabled) {
  try {
    sessionStorage.setItem(STORAGE_KEY, enabled ? "enabled" : "disabled");
  } catch {
    // A blocked storage API should not prevent the Studio from rendering.
  }
}

export default function DeveloperLensProvider({ children }) {
  const [enabled, setPreference] = useState(initialPreference);

  const setEnabled = useCallback((nextEnabled) => {
    const normalized = Boolean(nextEnabled);
    setPreference(normalized);
    persistPreference(normalized);
  }, []);

  const toggle = useCallback(() => {
    setPreference((current) => {
      const next = !current;
      persistPreference(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled, toggle }), [enabled, setEnabled, toggle]);

  return <DeveloperLensContext.Provider value={value}>{children}</DeveloperLensContext.Provider>;
}
