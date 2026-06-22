import { describe, expect, it } from "vitest";

import { API_HELPER_CONTRACTS } from "./apiClient";
import backendCapabilityManifest from "../contracts/backendCapabilityManifest.json";

const routeFor = (helperName) => API_HELPER_CONTRACTS.find((helper) => helper.helperName === helperName);

describe("capability parity contract", () => {
  it("keeps shopper surfaces on public routes", () => {
    [
      "getCatalog",
      "getCategories",
      "getProducts",
      "getCategoryProducts",
      "getProduct",
      "getRelatedProducts",
      "searchProducts",
      "getProductRecommendations",
      "sendChat",
    ].forEach((helperName) => {
      expect(routeFor(helperName)?.pathTemplate, helperName).not.toMatch(/^\/api\/admin\//);
    });
  });

  it("keeps Catalog Studio compatibility dependencies behind explicit helpers", () => {
    const manifestByRoute = new Map(
      backendCapabilityManifest.operations.map((operation) => [
        `${operation.method} ${operation.pathTemplate}`,
        operation,
      ]),
    );
    const catalogHelpers = API_HELPER_CONTRACTS.filter((helper) => (
      helper.pathTemplate.startsWith("/api/admin/catalog")
    ));

    catalogHelpers.forEach((helper) => {
      const operation = manifestByRoute.get(`${helper.method} ${helper.pathTemplate}`);
      const compatibility = operation?.contractStatus === "compatibility" || operation?.currentFrontendContract === false;
      if (!compatibility) return;
      expect(helper.compatibilityShim, helper.helperName).toBe(true);
      expect(`${helper.helperName} ${helper.reason || ""}`).toMatch(/compatibility|exception/i);
    });
  });

  it("keeps developer trace helpers on the developer trace surface", () => {
    const manifestByRoute = new Map(
      backendCapabilityManifest.operations.map((operation) => [
        `${operation.method} ${operation.pathTemplate}`,
        operation,
      ]),
    );
    [
      "getAdminApiTraces",
      "getAdminApiTrace",
      "getAdminApiTraceEvents",
      "postApiTraceEvent",
      "downloadAdminApiTrace",
      "subscribeAdminApiTraceEvents",
    ].forEach((helperName) => {
      const helper = routeFor(helperName);
      const operation = manifestByRoute.get(`${helper.method} ${helper.pathTemplate}`);
      expect(operation).toMatchObject({
        capabilityId: "developer_trace.read",
        surface: "developer_trace",
        contractStatus: "current",
      });
    });
  });
});
