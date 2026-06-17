import { createContext, useContext } from "react";

export const CatalogStudioAccessContext = createContext({
  status: "loading",
  session: null,
  retry: () => {},
});

export function useCatalogStudioAccess() {
  return useContext(CatalogStudioAccessContext);
}
