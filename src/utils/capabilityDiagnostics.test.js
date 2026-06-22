import { describe, expect, it } from "vitest";

import { capabilityDiagnosticParts, normalizeCapabilityDiagnostic } from "./capabilityDiagnostics";

describe("capabilityDiagnostics", () => {
  it("normalizes backend capability metadata from newer and older response shapes", () => {
    expect(normalizeCapabilityDiagnostic({
      capability_metadata: {
        capability_id: "shopper.chat.turn",
        surface: "public_shopper",
        status: "succeeded",
      },
    })).toMatchObject({
      capabilityId: "shopper.chat.turn",
      label: "Shopper chat",
      surface: "public_shopper",
      status: "succeeded",
    });

    expect(capabilityDiagnosticParts({ name: "legacy_tool", decision: "allowed" })).toEqual([
      "legacy_tool",
      "allowed",
    ]);
  });
});
