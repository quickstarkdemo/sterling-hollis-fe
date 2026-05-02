import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";

import ClerkBoundary from "./components/ClerkBoundary";
import "./styles.css";

const system = createSystem(defaultConfig, {
  theme: {
    tokens: {
      colors: {
        ink: {
          50: { value: "#faf8f3" },
          100: { value: "#eee8dc" },
          500: { value: "#6d6254" },
          700: { value: "#3d352d" },
          900: { value: "#17130f" },
        },
        saffron: {
          100: { value: "#fff4c8" },
          300: { value: "#f1c94b" },
          500: { value: "#c08b12" },
          700: { value: "#7a520a" },
        },
        sage: {
          100: { value: "#dfe8da" },
          300: { value: "#a7b894" },
          500: { value: "#60724d" },
        },
        oxblood: {
          100: { value: "#f3d7d1" },
          500: { value: "#8f3528" },
          700: { value: "#5d2119" },
        },
      },
      fonts: {
        heading: { value: "Georgia, 'Times New Roman', serif" },
        body: { value: "'Avenir Next', Avenir, 'Segoe UI', sans-serif" },
      },
    },
  },
  globalCss: {
    body: {
      bg: "#faf8f3",
      color: "ink.900",
      fontFamily: "body",
    },
    "*": {
      boxSizing: "border-box",
    },
    "html, body, #root": {
      minHeight: "100%",
    },
  },
});

const app = (
  <React.StrictMode>
    <ChakraProvider value={system}>
      <BrowserRouter>
        <ClerkBoundary />
      </BrowserRouter>
    </ChakraProvider>
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root")).render(app);
