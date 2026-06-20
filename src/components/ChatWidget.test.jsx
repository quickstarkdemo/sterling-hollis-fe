import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import { ChatContext } from "./ChatContext";
import ChatWidget from "./ChatWidget";
import {
  configureApiTraceRuntime,
  resetApiTraceRuntimeForTests,
  subscribeApiTraceEvents,
} from "../utils/apiTraceClient";
import { sendChat } from "../utils/apiClient";

vi.mock("../utils/apiClient", () => ({
  sendChat: vi.fn(),
}));

function renderChat() {
  return renderWithProviders(
    <ChatContext.Provider
      value={{
        chatContext: {
          page_type: "product",
          route: "/product/cat_pillow",
          current_product: { id: "cat_pillow", title: "Black Pillow" },
        },
        setChatContext: () => {},
      }}
    >
      <ChatWidget />
    </ChatContext.Provider>,
    { route: "/product/cat_pillow" },
  );
}

describe("ChatWidget trace integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiTraceRuntimeForTests();
    class IntersectionObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiTraceRuntimeForTests();
  });

  it("registers storefront chat turns with the shared trace runtime", async () => {
    configureApiTraceRuntime({ authorized: true, enabled: true, surface: "storefront-chat" });
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    sendChat.mockResolvedValue({
      conversation_id: "conv_2",
      message: "The pillow is available in Dallas.",
      cards: [],
      actions: [],
      tool_trace: [],
    });

    renderChat();
    await userEvent.click(screen.getByRole("button", { name: "Chat" }));
    await userEvent.type(screen.getByPlaceholderText("Ask a shopping question"), "Is this available?");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("The pillow is available in Dallas.")).toBeInTheDocument();
    await waitFor(() => expect(events.map((event) => event.event_type)).toContain("ui.completed"));
    expect(events[0]).toMatchObject({
      event_type: "ui.started",
      attributes: expect.objectContaining({
        action: "chat_turn",
        product_id: "cat_pillow",
        surface: "storefront-chat",
      }),
    });
    expect(events.at(-1)).toMatchObject({
      event_type: "ui.completed",
      attributes: expect.objectContaining({
        conversation_id: "conv_2",
      }),
    });
  });
});
