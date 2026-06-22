import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import {
  configureApiTraceRuntime,
  resetApiTraceRuntimeForTests,
  subscribeApiTraceEvents,
} from "../../utils/apiTraceClient";
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
    resetApiTraceRuntimeForTests();
    configureApiTraceRuntime({
      authorized: true,
      enabled: true,
      surface: "catalog-studio",
    });
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

  afterEach(() => {
    vi.useRealTimers();
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

  it("attaches and plays remote assistant audio when a Realtime track arrives", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { peer, media } = renderVoice();

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled());
    act(() => peer.ontrack?.({ streams: [media.stream] }));

    expect(document.querySelector("audio[data-realtime-audio='true']")).toBeInTheDocument();
    expect(play).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Stop voice" }));
    expect(document.querySelector("audio[data-realtime-audio='true']")).not.toBeInTheDocument();
    play.mockRestore();
  });

  it("records bounded Realtime lifecycle events without audio, credentials, SDP, or transcript text", async () => {
    const events = [];
    const unsubscribe = subscribeApiTraceEvents((event) => events.push(event));
    const { channel } = renderVoice();

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    act(() => channel.message({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "private spoken product instruction",
      raw_audio: "private-audio",
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Stop voice" }));
    unsubscribe();

    expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining([
      "ui.started",
      "realtime.connected",
      "realtime.disconnected",
      "ui.completed",
    ]));
    const encoded = JSON.stringify(events);
    expect(encoded).not.toContain("private spoken product instruction");
    expect(encoded).not.toContain("private-audio");
    expect(encoded).not.toContain("ephemeral-secret");
    expect(encoded).not.toContain("offer-sdp");
  });

  it("keeps the SDP exchange out of API trace capture", async () => {
    const events = [];
    const unsubscribe = subscribeApiTraceEvents((event) => events.push(event));
    const fetchSpy = vi.fn().mockResolvedValue(new Response("answer-sdp", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const { peer } = renderVoice({ props: { exchangeSdp: undefined } });

      await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
      await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" }));

      expect(fetchSpy).toHaveBeenCalledWith("https://api.openai.com/v1/realtime/calls", expect.objectContaining({
        body: "offer-sdp",
        headers: expect.objectContaining({ Authorization: "Bearer ephemeral-secret" }),
      }));
      const encoded = JSON.stringify(events);
      expect(encoded).not.toContain("ephemeral-secret");
      expect(encoded).not.toContain("offer-sdp");
      expect(encoded).not.toContain("answer-sdp");
    } finally {
      unsubscribe();
      vi.unstubAllGlobals();
    }
  });

  it("starts the shared microphone when an inline field control selects a pinned target", async () => {
    const channel = new FakeDataChannel();
    const peer = new FakePeerConnection(channel);
    const media = microphone();
    const requestMicrophone = vi.fn().mockResolvedValue(media.stream);

    function Harness() {
      const [startSignal, setStartSignal] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setStartSignal((current) => current + 1)}>Use voice for description</button>
          <VoiceControls
            workflowId="workflow_1"
            startSignal={startSignal}
            sessionContext={{ mode: "field", product_id: "cat_coat", draft_id: "draft_1", expected_draft_version: 2, target_path: "/description" }}
            contextLabel="Description"
            createPeerConnection={() => peer}
            requestMicrophone={requestMicrophone}
            exchangeSdp={() => Promise.resolve("answer-sdp")}
            now={() => 0}
          />
        </>
      );
    }

    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Use voice for description" }));
    await waitFor(() => expect(requestMicrophone).toHaveBeenCalledTimes(1));
    expect(api.createCatalogRealtimeSession).toHaveBeenCalledWith("workflow_1", expect.objectContaining({ mode: "field", target_path: "/description" }));
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

  it("keeps the session open for provider error events on an active connection", async () => {
    const { channel } = renderVoice();

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    act(() => channel.message({
      type: "error",
      error: {
        code: "conversation_already_has_active_response",
        message: "A response is already active.",
      },
    }));

    expect(await screen.findByText("listening")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop voice" })).toBeInTheDocument();
    expect(screen.getByText(/voice session is still open/i)).toBeInTheDocument();
  });

  it("does not mark a connected voice trace as failed when the browser disconnects later", async () => {
    const events = [];
    const unsubscribe = subscribeApiTraceEvents((event) => events.push(event));
    const { channel, peer } = renderVoice();

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    expect(await screen.findByText("listening")).toBeInTheDocument();

    vi.useFakeTimers();
    peer.connectionState = "disconnected";
    act(() => peer.onconnectionstatechange());
    act(() => vi.advanceTimersByTime(8000));
    unsubscribe();

    expect(screen.getByText("disconnected")).toBeInTheDocument();
    expect(events.some((event) => event.event_type === "ui.failed")).toBe(false);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: "ui.completed",
        status: "completed",
        attributes: expect.objectContaining({
          connection_state: "disconnected",
          transport: "webrtc",
        }),
      }),
    ]));
  });

  it("publishes finalized transcript entries for compact chat composers", async () => {
    const onTranscriptEntry = vi.fn();
    const { channel } = renderVoice({ props: { compact: true, onTranscriptEntry } });
    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());

    act(() => {
      channel.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "Which stores are low?" });
      channel.message({ type: "response.output_audio_transcript.done", transcript: "Dallas is low on stock." });
    });

    expect(onTranscriptEntry).toHaveBeenCalledWith(expect.objectContaining({
      role: "presenter",
      text: "Which stores are low?",
      workflowId: "workflow_1",
    }));
    expect(onTranscriptEntry).toHaveBeenCalledWith(expect.objectContaining({
      role: "assistant",
      text: "Dallas is low on stock.",
      workflowId: "workflow_1",
    }));
    expect(screen.queryByText("Which stores are low?")).not.toBeInTheDocument();
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
    expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('\\"status\\":\\"succeeded\\"'));
    expect(api.submitCatalogRealtimeToolCall).not.toHaveBeenCalled();
  });

  it("lets read-mode assistant surfaces resolve Realtime tools through their own API path", async () => {
    const onResolveToolCall = vi.fn().mockResolvedValue({
      mutation: false,
      message: "Oak Brook has 7 units from the assistant API.",
      citations: [{ kind: "inventory", source_id: "store_oak_brook", label: "Oak Brook", value: { inventory_qty: 7 } }],
    });
    const { channel } = renderVoice({ props: { assistantMode: "read", onResolveToolCall } });

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    act(() => channel.message({
      type: "response.function_call_arguments.done",
      call_id: "call_catalog_read",
      name: "read_inventory_status",
      arguments: JSON.stringify({ question: "Which stores need replenishment?" }),
    }));

    await waitFor(() => expect(onResolveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ name: "read_inventory_status" }),
      idempotencyKey: "voice-tool-call_catalog_read",
      workflowId: "workflow_1",
    })));
    expect(api.submitCatalogRealtimeV3ToolCall).not.toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledWith(expect.stringContaining("Oak Brook has 7 units"));
    expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('\\"status\\":\\"succeeded\\"'));
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

  it("preserves state on hard network failure and permits reconnect", async () => {
    const { peer } = renderVoice();
    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    peer.connectionState = "failed";
    act(() => peer.onconnectionstatechange());

    expect(await screen.findByText("disconnected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start fresh session" })).toBeInTheDocument();
  });

  it("does not close immediately for transient browser disconnects", async () => {
    const { channel, peer } = renderVoice();

    await userEvent.click(screen.getByRole("button", { name: "Start voice" }));
    act(() => channel.open());
    peer.connectionState = "disconnected";
    act(() => peer.onconnectionstatechange());

    expect(await screen.findByText("listening")).toBeInTheDocument();
    expect(screen.getByText(/browser reconnects/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop voice" })).toBeInTheDocument();

    peer.connectionState = "connected";
    act(() => peer.onconnectionstatechange());
    await waitFor(() => expect(screen.queryByText(/browser reconnects/i)).not.toBeInTheDocument());
  });
});
