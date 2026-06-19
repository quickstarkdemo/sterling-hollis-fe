import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import VoiceControls from "./VoiceControls";

const api = vi.hoisted(() => ({
  createCatalogRealtimeSession: vi.fn(),
  submitCatalogRealtimeToolCall: vi.fn(),
  submitCatalogRealtimeV3ToolCall: vi.fn(),
}));

vi.mock("../../utils/apiClient", () => api);

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

function session(overrides = {}) {
  return {
    client_secret: "ephemeral-secret",
    expires_at: 100,
    workflow_id: "workflow_1",
    model: "gpt-realtime",
    webrtc_url: "https://api.openai.com/v1/realtime/calls",
    tool_names: ["refine_catalog_draft"],
    ...overrides,
  };
}

function renderVoice(overrides = {}) {
  const channel = overrides.channel || new FakeDataChannel();
  const peer = overrides.peer || new FakePeerConnection(channel);
  const media = overrides.media || microphone();
  const props = {
    workflowId: "workflow_1",
    createPeerConnection: () => peer,
    requestMicrophone: vi.fn().mockResolvedValue(media.stream),
    exchangeSdp: vi.fn().mockResolvedValue("answer-sdp"),
    now: () => 0,
    ...overrides.props,
  };
  const view = renderWithProviders(<VoiceControls {...props} />);
  return { ...view, channel, peer, media, props };
}

describe("VoiceControls", () => {
  beforeEach(() => {
    api.createCatalogRealtimeSession.mockReset().mockResolvedValue(session());
    api.submitCatalogRealtimeToolCall.mockReset().mockResolvedValue({
      status: "succeeded",
      message: "Draft refined.",
      retryable: false,
      draft: { id: "draft_1", draft_version: 2 },
    });
    api.submitCatalogRealtimeV3ToolCall.mockReset().mockResolvedValue({
      mutation: false,
      message: "Dallas is low on stock.",
      citations: [],
    });
  });

  it("requests microphone permission and transitions from connecting to listening", async () => {
    const { channel, peer, props } = renderVoice();

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    expect(props.requestMicrophone).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("connecting")).toBeInTheDocument();
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });

    act(() => channel.open());
    expect(await screen.findByText("listening")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop voice" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("ephemeral-secret");
  });

  it.each([
    ["feature_disabled", /disabled in this environment/i],
    ["missing_api_key", /OpenAI API key/i],
    ["missing_safety_secret", /safety identifier secret/i],
  ])("preflights %s before requesting microphone permission", async (reason, message) => {
    const { props } = renderVoice({
      props: { realtimeCapability: { configured: false, reason } },
    });

    expect(screen.getByText("unavailable")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start voice" })).toBeDisabled();
    expect(props.requestMicrophone).not.toHaveBeenCalled();
    expect(api.createCatalogRealtimeSession).not.toHaveBeenCalled();
  });

  it("keeps text available when microphone permission is denied", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    renderVoice({ props: { requestMicrophone: vi.fn().mockRejectedValue(denied) } });

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));

    expect(await screen.findByText("denied")).toBeInTheDocument();
    expect(screen.getByText(/Use text or allow microphone access/i)).toBeInTheDocument();
    expect(api.createCatalogRealtimeSession).not.toHaveBeenCalled();
  });

  it("falls back to text when browser media APIs are unsupported", async () => {
    renderVoice({
      props: { requestMicrophone: () => { throw new Error("realtime_unsupported"); } },
    });

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));

    expect(await screen.findByText("unavailable")).toBeInTheDocument();
    expect(screen.getByText(/not supported in this browser/i)).toBeInTheDocument();
    expect(api.createCatalogRealtimeSession).not.toHaveBeenCalled();
  });

  it.each([
    ["realtime_timeout", "timeout"],
    ["realtime_unavailable", "provider"],
    ["realtime_failed", "provider"],
  ])("maps backend %s failures to %s", async (code, expectedStatus) => {
    api.createCatalogRealtimeSession.mockRejectedValueOnce({
      response: { data: { detail: { code, retryable: code !== "realtime_failed" } } },
    });
    renderVoice();

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));

    expect(await screen.findByText(expectedStatus)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start fresh session" })).toBeInTheDocument();
  });

  it("refuses to send the ephemeral credential to an unexpected WebRTC URL", async () => {
    api.createCatalogRealtimeSession.mockResolvedValueOnce(session({ webrtc_url: "https://example.com/collect" }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderVoice({ props: { exchangeSdp: undefined } });

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));

    expect(await screen.findByText("transport")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("aborts an in-flight SDP exchange when the presenter stops voice", async () => {
    let exchangeSignal;
    const exchangeSdp = vi.fn((sessionPayload, offer, signal) => {
      exchangeSignal = signal;
      return new Promise(() => {});
    });
    renderVoice({ props: { exchangeSdp } });

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    await waitFor(() => expect(exchangeSdp).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Stop voice" }));

    expect(exchangeSignal.aborted).toBe(true);
  });

  it("does not issue a Realtime credential after stop while workflow creation is pending", async () => {
    let resolveWorkflow;
    const ensureWorkflow = vi.fn(() => new Promise((resolve) => { resolveWorkflow = resolve; }));
    renderVoice({ props: { workflowId: "", ensureWorkflow } });

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    expect(await screen.findByText("connecting")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop voice" }));
    resolveWorkflow("workflow_1");
    await Promise.resolve();

    expect(api.createCatalogRealtimeSession).not.toHaveBeenCalled();
  });

  it("renders transcript deltas and applies each final tool call once", async () => {
    const onToolResult = vi.fn();
    const { channel } = renderVoice({ props: { onToolResult } });
    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());

    act(() => {
      channel.message({ type: "conversation.item.input_audio_transcription.delta", delta: "Make it " });
      channel.message({ type: "conversation.item.input_audio_transcription.delta", delta: "ivory" });
    });
    expect(await screen.findByText("Make it ivory")).toBeInTheDocument();
    act(() => channel.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "Make it ivory." }));
    expect(await screen.findByText("Make it ivory.")).toBeInTheDocument();

    const toolEvent = {
      type: "response.function_call_arguments.done",
      call_id: "call_1",
      name: "refine_catalog_draft",
      arguments: JSON.stringify({
        instruction: "Make it ivory",
        current_draft_id: "draft_1",
        expected_draft_version: 1,
      }),
    };
    act(() => {
      channel.message(toolEvent);
      channel.message(toolEvent);
    });

    await waitFor(() => expect(api.submitCatalogRealtimeToolCall).toHaveBeenCalledTimes(1));
    expect(onToolResult).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledWith(expect.stringContaining("function_call_output"));
    expect(channel.send).toHaveBeenCalledWith(expect.stringContaining("response.create"));
  });

  it("pins workbench voice calls to the active product session", async () => {
    const context = {
      mode: "workbench",
      product_id: "cat_one",
      draft_id: "draft_one",
      expected_draft_version: 3,
      query_scopes: ["product", "catalog", "inventory", "readiness"],
    };
    api.createCatalogRealtimeSession.mockResolvedValueOnce(session({
      session_id: "realtime_session_one",
      tool_names: ["read_inventory_status"],
    }));
    const { channel } = renderVoice({ props: { sessionContext: context } });

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    act(() => channel.message({
      type: "response.function_call_arguments.done",
      call_id: "call_inventory",
      name: "read_inventory_status",
      arguments: JSON.stringify({ question: "Which store is low on stock?" }),
    }));

    expect(api.createCatalogRealtimeSession).toHaveBeenCalledWith("workflow_1", context);
    await waitFor(() => expect(api.submitCatalogRealtimeV3ToolCall).toHaveBeenCalledWith(
      "workflow_1",
      expect.objectContaining({ session_id: "realtime_session_one", name: "read_inventory_status" }),
      "voice-tool-call_inventory",
    ));
    expect(api.submitCatalogRealtimeToolCall).not.toHaveBeenCalled();
  });

  it("uses current workflow callbacks for events arriving after a parent rerender", async () => {
    const firstResult = vi.fn();
    const latestResult = vi.fn();
    const firstEvent = vi.fn();
    const latestEvent = vi.fn();
    const channel = new FakeDataChannel();
    const peer = new FakePeerConnection(channel);
    const media = microphone();

    function Harness() {
      const [latest, setLatest] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setLatest(true)}>Update callbacks</button>
          <VoiceControls
            workflowId="workflow_1"
            createPeerConnection={() => peer}
            requestMicrophone={() => Promise.resolve(media.stream)}
            exchangeSdp={() => Promise.resolve("answer-sdp")}
            now={() => 0}
            onToolResult={latest ? latestResult : firstResult}
            onWorkflowEvent={latest ? latestEvent : firstEvent}
          />
        </>
      );
    }

    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    await userEvent.click(screen.getByRole("button", { name: "Update callbacks" }));
    act(() => channel.message({
      type: "response.function_call_arguments.done",
      call_id: "call_latest",
      name: "refine_catalog_draft",
      arguments: JSON.stringify({
        instruction: "Make it ivory",
        current_draft_id: "draft_1",
        expected_draft_version: 1,
      }),
    }));

    await waitFor(() => expect(latestResult).toHaveBeenCalledTimes(1));
    expect(firstResult).not.toHaveBeenCalled();
    expect(latestEvent).toHaveBeenCalled();
  });

  it("keeps provider call identifiers within the backend idempotency-header limit", async () => {
    const { channel } = renderVoice();
    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    act(() => channel.message({
      type: "response.function_call_arguments.done",
      call_id: `call_${"x".repeat(123)}`,
      name: "refine_catalog_draft",
      arguments: JSON.stringify({
        instruction: "Make it ivory",
        current_draft_id: "draft_1",
        expected_draft_version: 1,
      }),
    }));

    await waitFor(() => expect(api.submitCatalogRealtimeToolCall).toHaveBeenCalled());
    const idempotencyKey = api.submitCatalogRealtimeToolCall.mock.calls[0][2];
    expect(idempotencyKey.length).toBeLessThanOrEqual(128);
    expect(idempotencyKey).toMatch(/^voice-tool-/);
  });

  it("stops media tracks and ignores late mutations", async () => {
    const onToolResult = vi.fn();
    const { channel, media, peer } = renderVoice({ props: { onToolResult } });
    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    await userEvent.click(await screen.findByRole("button", { name: "Stop voice" }));

    expect(media.track.stop).toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled();
    act(() => channel.message({
        type: "response.function_call_arguments.done",
        call_id: "late_call",
        name: "refine_catalog_draft",
        arguments: "{}",
      }));
    await Promise.resolve();
    expect(api.submitCatalogRealtimeToolCall).not.toHaveBeenCalled();
    expect(onToolResult).not.toHaveBeenCalled();
  });

  it("reports expiration and allows a fresh session", async () => {
    api.createCatalogRealtimeSession
      .mockResolvedValueOnce(session({ expires_at: 1 }))
      .mockResolvedValueOnce(session({ expires_at: 10 }));
    const firstMedia = microphone();
    const secondMedia = microphone();
    const requestMicrophone = vi.fn()
      .mockResolvedValueOnce(firstMedia.stream)
      .mockResolvedValueOnce(secondMedia.stream);
    const channel = new FakeDataChannel();
    const peer = new FakePeerConnection(channel);
    renderVoice({
      channel,
      peer,
      props: { requestMicrophone, now: () => 2000 },
    });

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    expect(await screen.findByText("expired")).toBeInTheDocument();
    expect(firstMedia.track.stop).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Start fresh session" }));
    await waitFor(() => expect(api.createCatalogRealtimeSession).toHaveBeenCalledTimes(2));
    expect(screen.getByText("connecting")).toBeInTheDocument();
  });

  it("preserves state on network disconnect and permits reconnect", async () => {
    const { peer } = renderVoice();
    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    peer.connectionState = "disconnected";
    act(() => peer.onconnectionstatechange());

    expect(await screen.findByText("disconnected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start fresh session" })).toBeInTheDocument();
  });
});
