import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import TraceArtifactViewer from "./TraceArtifactViewer";

describe("TraceArtifactViewer", () => {
  it("renders safe metadata and selects an artifact", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <TraceArtifactViewer
        artifacts={[{ artifact_id: "art-1", artifact_type: "image", name: "Generated scene", media_type: "image/jpeg", size_bytes: 2048 }]}
        selection={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("option", { name: /Generated scene/ }));
    expect(screen.getByText(/2.0 KB/)).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith({ kind: "artifact", id: "art-1" });
  });
});
