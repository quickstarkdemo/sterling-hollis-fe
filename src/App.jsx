import { Route, Routes } from "react-router-dom";

import { initDatadog } from "./utils/datadog";
import CategoryPage from "./pages/CategoryPage";
import HomePage from "./pages/HomePage";
import ProductPage from "./pages/ProductPage";
import StyleFinderPage from "./pages/StyleFinderPage";
import ChatContextProvider from "./components/ChatContextProvider";
import Shell from "./components/Shell";

initDatadog();

export default function App() {
  return (
    <ChatContextProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/category/:category" element={<CategoryPage />} />
          <Route path="/product/:productId" element={<ProductPage />} />
          <Route path="/style-finder" element={<StyleFinderPage />} />
        </Routes>
      </Shell>
    </ChatContextProvider>
  );
}
