import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import RealtimeTranscript from "./RealtimeTranscript";

describe("RealtimeTranscript", () => {
  it("renders progressive and completed presenter and assistant transcript state", () => {
    const { unmount } = renderWithProviders(
      <RealtimeTranscript presenterPartial="Make the coat" assistantPartial="I can update" />,
    );

    expect(screen.getByText("Make the coat")).toBeInTheDocument();
    expect(screen.getByText("I can update")).toBeInTheDocument();

    unmount();
    renderWithProviders(
      <RealtimeTranscript
        entries={[
          { id: "presenter-1", role: "presenter", text: "Make the coat ivory." },
          { id: "assistant-1", role: "assistant", text: "I updated the draft." },
        ]}
      />,
    );

    expect(screen.getByText("Make the coat ivory.")).toBeInTheDocument();
    expect(screen.getByText("I updated the draft.")).toBeInTheDocument();
    expect(screen.queryByText("Make the coat")).not.toBeInTheDocument();
  });
});
