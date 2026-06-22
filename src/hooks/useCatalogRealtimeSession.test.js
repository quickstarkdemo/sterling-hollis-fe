import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import useCatalogRealtimeSession from "./useCatalogRealtimeSession";

const api = vi.hoisted(() => ({
  createCatalogRealtimeSession: vi.fn(),
  submitCatalogRealtimeCompatibilityToolCall: vi.fn(),
  submitCatalogRealtimeV3ToolCall: vi.fn(),
}));

vi.mock("../utils/apiClient", () => api);

beforeEach(() => {
  api.createCatalogRealtimeSession.mockReset().mockResolvedValue({ session_id: "session_one" });
  api.submitCatalogRealtimeCompatibilityToolCall.mockReset().mockResolvedValue({ status: "succeeded" });
  api.submitCatalogRealtimeV3ToolCall.mockReset().mockResolvedValue({ mutation: false });
});

it("routes active-product tools through the pinned v3 session", async () => {
  const context = {
    mode: "workbench",
    product_id: "cat_one",
    draft_id: "draft_one",
    expected_draft_version: 2,
    query_scopes: ["product"],
  };
  const { result } = renderHook(() => useCatalogRealtimeSession(context));

  await act(() => result.current.startBackendSession("workflow_one"));
  await act(() => result.current.submitToolCall("workflow_one", {
    call_id: "call_one",
    name: "read_product_summary",
    arguments: JSON.stringify({ question: "What product is active?" }),
  }, "voice-call-one"));

  expect(api.createCatalogRealtimeSession).toHaveBeenCalledWith("workflow_one", context);
  expect(api.submitCatalogRealtimeV3ToolCall).toHaveBeenCalledWith(
    "workflow_one",
    expect.objectContaining({ session_id: "session_one", name: "read_product_summary" }),
    "voice-call-one",
  );
  expect(api.submitCatalogRealtimeCompatibilityToolCall).not.toHaveBeenCalled();
});

it("keeps legacy new-draft tools on the compatibility endpoint", async () => {
  const { result } = renderHook(() => useCatalogRealtimeSession(null));

  await act(() => result.current.startBackendSession("workflow_one"));
  await act(() => result.current.submitToolCall("workflow_one", {
    call_id: "call_create",
    name: "create_catalog_draft",
    arguments: JSON.stringify({ instruction: "Create a coat", current_draft_id: null, expected_draft_version: 0 }),
  }, "voice-call-create"));

  expect(api.submitCatalogRealtimeCompatibilityToolCall).toHaveBeenCalled();
  expect(api.submitCatalogRealtimeV3ToolCall).not.toHaveBeenCalled();
});
