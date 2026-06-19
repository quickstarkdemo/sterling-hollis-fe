import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import FieldVoiceControl from "./FieldVoiceControl";

it("requests one server-pinned voice field and a separate reviewable AI proposal", async () => {
  const onVoiceRequest = vi.fn();
  const onAiRequest = vi.fn();
  renderWithProviders(<FieldVoiceControl label="Description" targetPath="/description" onVoiceRequest={onVoiceRequest} onAiRequest={onAiRequest} />);

  await userEvent.click(screen.getByRole("button", { name: "Use voice for Description" }));
  await userEvent.click(screen.getByRole("button", { name: "Improve Description with AI" }));

  expect(onVoiceRequest).toHaveBeenCalledWith({ targetPath: "/description", label: "Description" });
  expect(onAiRequest).toHaveBeenCalledWith(expect.objectContaining({ targetPath: "/description", label: "Description" }));
});
