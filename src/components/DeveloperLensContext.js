import { createContext, useContext } from "react";

export const DeveloperLensContext = createContext({
  enabled: false,
  setEnabled: () => {},
  toggle: () => {},
});

export function useDeveloperLens() {
  return useContext(DeveloperLensContext);
}
