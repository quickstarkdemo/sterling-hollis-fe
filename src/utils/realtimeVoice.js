export const REALTIME_WEBRTC_URL = "https://api.openai.com/v1/realtime/calls";

export function realtimeErrorCode(error) {
  return error?.response?.data?.detail?.code || error?.message || "";
}

export function defaultPeerConnection() {
  if (typeof RTCPeerConnection === "undefined") throw new Error("realtime_unsupported");
  return new RTCPeerConnection();
}

export function defaultMicrophoneRequest() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("realtime_unsupported");
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export async function defaultSdpExchange(session, offerSdp, signal) {
  if (session.webrtc_url !== REALTIME_WEBRTC_URL) throw new Error("realtime_invalid_url");
  if (typeof fetch !== "function") throw new Error("realtime_unsupported");
  const response = await fetch(session.webrtc_url, {
    method: "POST",
    body: offerSdp,
    signal,
    headers: {
      Authorization: `Bearer ${session.client_secret}`,
      "Content-Type": "application/sdp",
    },
  });
  if (!response.ok) throw new Error("realtime_connection_failed");
  return response.text();
}

export function realtimeFailureStatus(error) {
  const code = realtimeErrorCode(error);
  if (code === "realtime_unsupported") return "unavailable";
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") return "denied";
  if (code === "realtime_timeout") return "timeout";
  if (["realtime_unavailable", "realtime_failed"].includes(code)) return "provider";
  if (["realtime_invalid_url", "realtime_connection_failed"].includes(code)) return "transport";
  return "error";
}
