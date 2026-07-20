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

  test("ArticleHeroSkeleton renders a pulsing 16:9 full-width block", () => {
    const { container } = render(<ArticleHeroSkeleton />);
    const bar = container.firstElementChild;
    expect(bar).toHaveClass("animate-pulse", "aspect-video", "w-full");
    expect(bar).not.toHaveClass("max-w-md");
  });

  test("ObituariesSkeleton renders a busy main with no thumb boxes", () => {
    const { container } = render(<ObituariesSkeleton />);
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
    const rows = container.querySelectorAll("main > div.border-b.border-hairline");
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row.querySelector(":scope > div.flex.gap-4")).toBeNull();
    }
  });
});
