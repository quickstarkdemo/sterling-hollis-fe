import { Route } from "react-router-dom";
import { Routes } from "@datadog/browser-rum-react/react-router-v6";

import CategoryPage from "./pages/CategoryPage";
import CatalogStudioPage from "./pages/CatalogStudioPage";
import HomePage from "./pages/HomePage";
import ProductPage from "./pages/ProductPage";
import SignInPage from "./pages/SignInPage";
import StyleFinderPage from "./pages/StyleFinderPage";
import ChatContextProvider from "./components/ChatContextProvider";
import AdminRoute, { CatalogStudioAccessProvider } from "./components/AdminRoute";
import DeveloperLensProvider from "./components/DeveloperLensProvider";
import { ApiTraceCapabilityBridge } from "./components/ApiTraceProvider";
import Shell from "./components/Shell";

export default function App() {
  return (
    <CatalogStudioAccessProvider>
      <DeveloperLensProvider>
        <ApiTraceCapabilityBridge />
        <ChatContextProvider>
          <Shell>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/category/:category" element={<CategoryPage />} />
              <Route path="/product/:productId" element={<ProductPage />} />
              <Route path="/sign-in/*" element={<SignInPage />} />
              <Route path="/style-finder" element={<StyleFinderPage />} />
              <Route
                path="/catalog-studio"
                element={
                  <AdminRoute>
                    <CatalogStudioPage />
                  </AdminRoute>
                }
              />
            </Routes>
          </Shell>
        </ChatContextProvider>
      </DeveloperLensProvider>
    </CatalogStudioAccessProvider>
  );
}
