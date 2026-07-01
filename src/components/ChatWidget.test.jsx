import { act, screen, waitFor } from "@testing-library/react";
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
import {
  createShopperRealtimeSession,
  getShopperRealtimeCapability,
  sendChat,
  submitShopperRealtimeToolCall,
} from "../utils/apiClient";

vi.mock("../utils/apiClient", () => ({
  createShopperRealtimeSession: vi.fn(),
  getShopperRealtimeCapability: vi.fn(),
  sendChat: vi.fn(),
  submitShopperRealtimeToolCall: vi.fn(),
}));

const api = {
  createShopperRealtimeSession,
  getShopperRealtimeCapability,
  sendChat,
  submitShopperRealtimeToolCall,
};

class FakeDataChannel extends EventTarget {
  constructor() {
    super();
    this.readyState = "connecting";
    this.send = vi.fn();
    this.close = vi.fn(() => { this.readyState = "closed"; });
  }

  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  message(payload) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

class FakePeerConnection {
  constructor(channel) {
    this.channel = channel;
    this.connectionState = "new";
    this.addTrack = vi.fn();
    this.close = vi.fn(() => { this.connectionState = "closed"; });
    this.createDataChannel = vi.fn(() => channel);
    this.createOffer = vi.fn().mockResolvedValue({ type: "offer", sdp: "offer-sdp" });
    this.setLocalDescription = vi.fn().mockResolvedValue(undefined);
    this.setRemoteDescription = vi.fn().mockResolvedValue(undefined);
  }
}

function microphone() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] }, track };
}

function shopperSession(overrides = {}) {
  return {
    client_secret: "ephemeral-shopper-secret",
    expires_at: 100,
    model: "gpt-realtime",
    webrtc_url: "https://api.openai.com/v1/realtime/calls",
    tool_names: ["shopper_chat_turn"],
    session_id: "shopper_realtime_1",
    ...overrides,
  };
}

function voiceProps(overrides = {}) {
  const channel = overrides.channel || new FakeDataChannel();
  const peer = overrides.peer || new FakePeerConnection(channel);
  const media = overrides.media || microphone();
  return {
    channel,
    media,
    peer,
    props: {
      createVoicePeerConnection: () => peer,
      requestVoiceMicrophone: vi.fn().mockResolvedValue(media.stream),
      exchangeVoiceSdp: vi.fn().mockResolvedValue("answer-sdp"),
      now: () => 0,
      ...overrides.props,
    },
  };
}

function renderChat(props = {}) {
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
      <ChatWidget {...props} />
    </ChatContext.Provider>,
    { route: "/product/cat_pillow" },
  );
}

describe("ChatWidget trace integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiTraceRuntimeForTests();
    api.getShopperRealtimeCapability.mockResolvedValue({
      configured: false,
      reason: "feature_disabled",
      model: null,
      webrtc_url: "https://api.openai.com/v1/realtime/calls",
      tool_names: [],
    });
    api.createShopperRealtimeSession.mockResolvedValue(shopperSession());
    api.submitShopperRealtimeToolCall.mockResolvedValue({
      status: "succeeded",
      message: "Voice answer.",
      chat_response: {
        conversation_id: "conv_voice",
        message: "Voice answer.",
        cards: [],
        actions: [],
        tool_trace: [],
      },
      tool_output: { message: "Voice answer.", conversation_id: "conv_voice" },
    });
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
    configureApiTraceRuntime({ authorized: true, enabled: true, surface: "catalog-studio" });
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

  it("renders capability diagnostics only when diagnostics are enabled", async () => {
    sendChat.mockResolvedValue({
      conversation_id: "conv_3",
      message: "The pillow is in stock.",
      cards: [],
      actions: [],
      tool_trace: [{
        capability_id: "public.catalog.product_detail",
        surface: "public_shopper",
        decision: "succeeded",
        name: "read_product",
      }],
    });

    renderChat({ showDiagnostics: true });
    await userEvent.click(screen.getByRole("button", { name: "Chat" }));
    await userEvent.type(screen.getByPlaceholderText("Ask a shopping question"), "Is this available?");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("The pillow is in stock.")).toBeInTheDocument();
    expect(screen.getByText("Product detail - public_shopper - succeeded")).toBeInTheDocument();
  });

  it("starts shopper voice and shows the listening indicator", async () => {
    api.getShopperRealtimeCapability.mockResolvedValue({
      configured: true,
      model: "gpt-realtime",
      webrtc_url: "https://api.openai.com/v1/realtime/calls",
      tool_names: ["shopper_chat_turn"],
    });
    const { channel, peer, props } = voiceProps();

    renderChat(props);
    await userEvent.click(screen.getByRole("button", { name: "Chat" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start voice" }));

    expect(props.requestVoiceMicrophone).toHaveBeenCalledTimes(1);
    expect(api.createShopperRealtimeSession).toHaveBeenCalledWith({
      context: expect.objectContaining({
        current_product: { id: "cat_pillow", title: "Black Pillow" },
        page_type: "product",
        route: "/product/cat_pillow",
      }),
    });
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });

    act(() => channel.open());
    expect(await screen.findByLabelText("Voice Listening")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop voice" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("ephemeral-shopper-secret");
  });

  it("routes shopper voice tool results into normal chat messages", async () => {
    configureApiTraceRuntime({ authorized: true, enabled: true, surface: "storefront-chat" });
    const events = [];
    subscribeApiTraceEvents((event) => events.push(event));
    api.getShopperRealtimeCapability.mockResolvedValue({
      configured: true,
      model: "gpt-realtime",
      webrtc_url: "https://api.openai.com/v1/realtime/calls",
      tool_names: ["shopper_chat_turn"],
    });
    api.submitShopperRealtimeToolCall.mockResolvedValue({
      status: "succeeded",
      message: "The pillow is available in Dallas.",
      chat_response: {
        conversation_id: "conv_voice",
        message: "The pillow is available in Dallas.",
        cards: [{
          id: "prod_voice",
          brand: "Sterling",
          title: "Voice Matched Pillow",
          price: 120,
          price_min: 120,
          price_max: 120,
          images: { thumbnail_url: "/voice-pillow.jpg" },
        }],
        actions: [{ type: "sign_in", label: "Sign in" }],
        tool_trace: [{ name: "product_detail", decision: "succeeded" }],
        identity_status: "anonymous",
      },
      tool_output: {
        message: "The pillow is available in Dallas.",
        conversation_id: "conv_voice",
        card_count: 1,
      },
    });
    const { channel, props } = voiceProps();

    renderChat({ ...props, showDiagnostics: true });
    await userEvent.click(screen.getByRole("button", { name: "Chat" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    act(() => channel.message({
      type: "response.function_call_arguments.done",
      call_id: "call_voice_1",
      name: "shopper_chat_turn",
      arguments: JSON.stringify({ message: "Is this available in Dallas?" }),
    }));

    expect(await screen.findByText("Is this available in Dallas?")).toBeInTheDocument();
    expect(await screen.findByText("The pillow is available in Dallas.")).toBeInTheDocument();
    expect(screen.getByText("Voice Matched Pillow")).toBeInTheDocument();
    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByText("product_detail - succeeded")).toBeInTheDocument();
    expect(api.submitShopperRealtimeToolCall).toHaveBeenCalledWith(expect.objectContaining({
      session_id: "shopper_realtime_1",
      call_id: "call_voice_1",
      name: "shopper_chat_turn",
      arguments: { message: "Is this available in Dallas?" },
      conversation_id: undefined,
      context: expect.objectContaining({ current_product: { id: "cat_pillow", title: "Black Pillow" } }),
    }));
    expect(channel.send).toHaveBeenCalledWith(expect.stringContaining("function_call_output"));
    expect(JSON.stringify(channel.send.mock.calls)).not.toContain("ephemeral-shopper-secret");
    expect(JSON.stringify(channel.send.mock.calls)).not.toContain("offer-sdp");
    await waitFor(() => expect(events.filter((event) => event.event_type === "conversation.turn")).toHaveLength(2));
    const turns = events.filter((event) => event.event_type === "conversation.turn");
    expect(turns[0].attributes).toMatchObject({
      route: "shopper_realtime_voice",
      selected_tool: "shopper_chat_turn",
      visible_messages: [expect.objectContaining({
        visible_role: "user",
        visible_source: "realtime_transcript",
        visible_text: "Is this available in Dallas?",
      })],
    });
    expect(turns[1].attributes).toMatchObject({
      card_count: 1,
      action_count: 1,
      tool_count: 1,
      conversation_id: "conv_voice",
      route: "shopper_realtime_voice",
      selected_tool: "shopper_chat_turn",
      turn_id: turns[0].attributes.turn_id,
      visible_messages: [expect.objectContaining({
        visible_role: "assistant",
        visible_source: "chat_response",
        visible_text: "The pillow is available in Dallas.",
      })],
    });
    expect(JSON.stringify(turns)).not.toContain("ephemeral-shopper-secret");
    expect(JSON.stringify(turns)).not.toContain("offer-sdp");
  });

  it("shows mapped unavailable voice state without blocking typed chat", async () => {
    api.getShopperRealtimeCapability.mockResolvedValue({
      configured: false,
      reason: "openai_unconfigured",
      model: null,
      webrtc_url: "https://api.openai.com/v1/realtime/calls",
      tool_names: [],
    });
    sendChat.mockResolvedValue({
      conversation_id: "conv_text",
      message: "Text still works.",
      cards: [],
      actions: [],
      tool_trace: [],
    });

    renderChat();
    await userEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(await screen.findByRole("button", { name: "Voice unavailable" })).toBeDisabled();
    expect(screen.getByText("Voice is not configured yet. Text chat is ready.")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Ask a shopping question"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Text still works.")).toBeInTheDocument();
  });

  it("keeps text available when shopper microphone permission is denied", async () => {
    api.getShopperRealtimeCapability.mockResolvedValue({
      configured: true,
      model: "gpt-realtime",
      webrtc_url: "https://api.openai.com/v1/realtime/calls",
      tool_names: ["shopper_chat_turn"],
    });
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const { props } = voiceProps({
      props: { requestVoiceMicrophone: vi.fn().mockRejectedValue(denied) },
    });
    sendChat.mockResolvedValue({
      conversation_id: "conv_after_denial",
      message: "Typed fallback works.",
      cards: [],
      actions: [],
      tool_trace: [],
    });

    renderChat(props);
    await userEvent.click(screen.getByRole("button", { name: "Chat" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start voice" }));

    expect(await screen.findByText("Microphone access was denied. Text chat is still available.")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Ask a shopping question"), "Use text");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Typed fallback works.")).toBeInTheDocument();
  });
});
