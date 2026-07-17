import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BoardSkeleton, DossierSkeleton, LifeSkeleton } from "./skeletons";

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
});
