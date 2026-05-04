import { Route } from "react-router-dom";
import { Routes } from "@datadog/browser-rum-react/react-router-v6";

import CategoryPage from "./pages/CategoryPage";
import HomePage from "./pages/HomePage";
import ProductPage from "./pages/ProductPage";
import SignInPage from "./pages/SignInPage";
import StyleFinderPage from "./pages/StyleFinderPage";
import ChatContextProvider from "./components/ChatContextProvider";
import Shell from "./components/Shell";

export default function App() {
  return (
    <ChatContextProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/category/:category" element={<CategoryPage />} />
          <Route path="/product/:productId" element={<ProductPage />} />
          <Route path="/sign-in/*" element={<SignInPage />} />
          <Route path="/style-finder" element={<StyleFinderPage />} />
        </Routes>
      </Shell>
    </ChatContextProvider>
  );
}
