import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BoardSkeleton, DossierSkeleton, LifeSkeleton, ObituariesSkeleton } from "./skeletons";

describe("skeletons", () => {
  test("BoardSkeleton renders a busy main with pulsing blocks", () => {
    const { container } = render(<BoardSkeleton />);
    const main = container.querySelector("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(5);
  });

  test("BoardSkeleton renders 22 compact skeleton rows", () => {
    const { container } = render(<BoardSkeleton />);
    expect(container.querySelectorAll("main > div.border-b.border-hairline-2").length).toBe(22);
  });

  test("DossierSkeleton renders a busy main with pulsing blocks", () => {
    const { container } = render(<DossierSkeleton />);
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(5);
  });

  test("LifeSkeleton renders a busy main with pulsing blocks", () => {
    const { container } = render(<LifeSkeleton />);
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(5);
  });

  test("ObituariesSkeleton renders a busy main with pulsing blocks", () => {
    const { container } = render(<ObituariesSkeleton />);
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(5);
  });
});
