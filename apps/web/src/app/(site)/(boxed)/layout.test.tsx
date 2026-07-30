import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import BoxedLayout from "./layout";

describe("BoxedLayout", () => {
  // ⚠️ THE ONLY declaration of content width in the app. Every page in this group used to set
  // its own — 1024 here, 68ch there, nothing at all on four of them — so the app was three
  // different widths on a wide monitor. A page-level `mx-auto max-w-*` is a regression.
  test("centers content in the 1024px box", () => {
    const { container } = render(<BoxedLayout><div /></BoxedLayout>);
    const box = container.firstElementChild!;
    expect(box.className).toMatch(/(^|\s)max-w-5xl(\s|$)/);
    expect(box.className).toMatch(/(^|\s)mx-auto(\s|$)/);
    expect(box.className).not.toMatch(/1440px/);
  });

  // ⚠️ The box owns the WIDTH, never the horizontal padding. Pages set their own inset because
  // it is not uniform on purpose: prose uses px-6 md:px-10, while /survivors/[map] and the
  // dossier declare none and run their tables edge to edge below xl. Padding here puts gutters
  // on those tables.
  test("declares no horizontal padding", () => {
    const { container } = render(<BoxedLayout><div /></BoxedLayout>);
    expect(container.firstElementChild!.className).not.toMatch(/(^|\s)(xl:)?px-/);
  });

  // Continues the height chain from #main-content so a page that fills the viewport still can.
  test("keeps the flex column", () => {
    const { container } = render(<BoxedLayout><div /></BoxedLayout>);
    const box = container.firstElementChild!;
    expect(box.className).toMatch(/(^|\s)flex(\s|$)/);
    expect(box.className).toMatch(/(^|\s)flex-1(\s|$)/);
    expect(box.className).toMatch(/(^|\s)flex-col(\s|$)/);
  });
});
