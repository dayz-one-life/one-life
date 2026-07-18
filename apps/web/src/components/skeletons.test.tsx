import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ArticleHeroSkeleton, BoardSkeleton, DossierSkeleton, LifeSkeleton, ObituariesSkeleton } from "./skeletons";

describe("skeletons", () => {
  test("BoardSkeleton renders a busy main with pulsing blocks", () => {
    const { container } = render(<BoardSkeleton />);
    const main = container.querySelector("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
  });

  test("DossierSkeleton renders a busy main with pulsing blocks", () => {
    const { container } = render(<DossierSkeleton />);
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
  });

  test("LifeSkeleton renders a busy main with pulsing blocks", () => {
    const { container } = render(<LifeSkeleton />);
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
  });

  test("ArticleHeroSkeleton renders a pulsing 4:5 max-w-md block", () => {
    const { container } = render(<ArticleHeroSkeleton />);
    const bar = container.firstElementChild;
    expect(bar).toHaveClass("animate-pulse", "aspect-[4/5]", "max-w-md");
  });

  test("ObituariesSkeleton renders a busy main with row thumb boxes mirroring the card layout", () => {
    const { container } = render(<ObituariesSkeleton />);
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
    const rows = container.querySelectorAll("main > div.border-b.border-hairline");
    expect(rows.length).toBe(5);
    for (const row of rows) {
      const wrapper = row.querySelector(":scope > div.flex.gap-4");
      expect(wrapper).not.toBeNull();
      const thumb = wrapper!.firstElementChild;
      expect(thumb).toHaveClass("animate-pulse", "hidden", "h-24", "w-24", "shrink-0", "sm:block");
    }
  });
});
