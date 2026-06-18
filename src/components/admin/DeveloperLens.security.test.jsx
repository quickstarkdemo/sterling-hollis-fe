import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DeveloperLensProvider from "../DeveloperLensProvider";
import { renderWithProviders } from "../../test/render";
import DeveloperLens from "./DeveloperLens";

const SECRETS = ["Bearer private-token", "sk-private", "private reasoning", "raw system prompt", "voice-token"];

const adversarialEvent = {
  id: "event_adversarial",
  sequence: 1,
  stage: "responses",
  capability: "responses",
  status: "succeeded",
  developer: {
    model: "gpt-5",
    request_payload: {
      authorization: SECRETS[0],
      nested: [{ api_key: SECRETS[1] }, { raw_prompt: SECRETS[3] }],
      credentials: { realtime_token: SECRETS[4] },
    },
    response_payload: {
      chain_of_thought: SECRETS[2],
      safe_projection: { title: "Visible coat" },
    },
  },
};

describe("DeveloperLens security boundary", () => {
  beforeEach(() => {
    sessionStorage.setItem("sterling-hollis:catalog-studio:developer-lens", "enabled");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("redacts protected fields at every nesting level in rendered and copied projections", async () => {
    renderWithProviders(<DeveloperLensProvider><DeveloperLens events={[adversarialEvent]} /></DeveloperLensProvider>);

    expect(document.body).toHaveTextContent("Visible coat");
    for (const secret of SECRETS) expect(document.body).not.toHaveTextContent(secret);

    for (const button of screen.getAllByRole("button", { name: "Copy" })) await userEvent.click(button);
    const copied = navigator.clipboard.writeText.mock.calls.map(([text]) => text).join("\n");
    expect(copied).toContain("[REDACTED]");
    for (const secret of SECRETS) expect(copied).not.toContain(secret);
  });

  it("bounds oversized and cyclic projections without leaking omitted fields", () => {
    const cyclic = { safe: "visible" };
    cyclic.self = cyclic;
    const oversized = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`field_${index}`, "x".repeat(100)]));
    oversized.password = "never-visible-password";
    const event = {
      ...adversarialEvent,
      developer: { ...adversarialEvent.developer, request_payload: cyclic, response_payload: oversized },
    };

    const { container } = renderWithProviders(<DeveloperLensProvider><DeveloperLens events={[event]} /></DeveloperLensProvider>);

    expect(container).toHaveTextContent("[CIRCULAR]");
    expect(container.querySelector('[data-truncated="true"]')).toBeInTheDocument();
    expect(container).not.toHaveTextContent("never-visible-password");
  });

  it("renders nothing when the developer lens is disabled", () => {
    sessionStorage.setItem("sterling-hollis:catalog-studio:developer-lens", "disabled");
    const { container } = render(<DeveloperLensProvider><DeveloperLens events={[adversarialEvent]} /></DeveloperLensProvider>);
    expect(container).toBeEmptyDOMElement();
  });
});
