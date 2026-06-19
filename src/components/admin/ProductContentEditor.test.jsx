import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import ProductContentEditor from "./ProductContentEditor";

const product = {
  description: "Original description",
  benefits: ["Warm"],
  specifications: [{ name: "material", value: "Wool" }],
  care_instructions: ["Dry clean"],
  content_details: ["Fully lined"],
  seo: { title: "Coat", description: "A wool coat", keywords: ["wool coat"] },
  readiness_inputs: { required_specifications: ["material"] },
};

function Harness(props) {
  const [value, setValue] = useState(product);
  return <ProductContentEditor product={value} onChange={setValue} {...props} />;
}

it("edits structured product content and exposes voice only for eligible fields", async () => {
  const onVoiceRequest = vi.fn();
  renderWithProviders(<Harness onVoiceRequest={onVoiceRequest} />);

  await userEvent.clear(screen.getByLabelText("Product benefits"));
  await userEvent.type(screen.getByLabelText("Product benefits"), "Warm without bulk\nEasy to layer");
  await userEvent.click(screen.getByRole("button", { name: "Use voice for SEO description" }));

  expect(screen.getByLabelText("Product benefits")).toHaveValue("Warm without bulk\nEasy to layer");
  expect(onVoiceRequest).toHaveBeenCalledWith({ targetPath: "/seo/description", label: "SEO description" });
  expect(screen.queryByRole("button", { name: /voice.*required product specifications/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Use voice for Care instructions" })).not.toBeInTheDocument();
});
