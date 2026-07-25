import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import BoxedLayout from "./layout";

describe("BoxedLayout", () => {
  // The box that used to live on #main-content. It moved here so /maps/[map] can go edge to
  // edge; every other page must still be centered and capped.
  test("centers content in the 1440px box with the xl gutters", () => {
    const { container } = render(<BoxedLayout><div /></BoxedLayout>);
    const box = container.firstElementChild!;
    expect(box.className).toMatch(/max-w-\[1440px\]/);
    expect(box.className).toMatch(/mx-auto/);
    expect(box.className).toMatch(/xl:px-10/);
  });
});
