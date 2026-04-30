import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function versionInjectionPlugin() {
  return {
    name: "version-injection",
    config: () => {
      let version = "0.1.0";
      let gitSha = "local";

      try {
        const versionPath = path.join(process.cwd(), "VERSION");
        if (fs.existsSync(versionPath)) {
          version = fs.readFileSync(versionPath, "utf8").trim() || version;
        }
        gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
      } catch {
        gitSha = "local";
      }

      return {
        define: {
          "import.meta.env.VITE_RELEASE": JSON.stringify(`${version}-${gitSha}`),
        },
      };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_API_PROXY_TARGET || env.VITE_API_URL || "https://products-api.quickstark.com";

  return {
    plugins: [versionInjectionPlugin(), react({ jsxRuntime: "automatic" })],
    server: {
      headers: {
        "Document-Policy": "js-profiling",
      },
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
        },
        "/health": {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    build: {
      sourcemap: false,
      emptyOutDir: true,
      chunkSizeWarningLimit: 900,
    },
  };
});
