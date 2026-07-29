import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Avatar, avatarSrc } from "./avatar";

describe("avatarSrc", () => {
  test("builds the API avatar path from the hash", () => {
    expect(avatarSrc("abc123")).toBe("/api/avatars/abc123.webp");
  });
});

describe("Avatar", () => {
  test("renders the img when a hash is present", () => {
    const { container } = render(<Avatar hash="abc123" size={48} />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "/api/avatars/abc123.webp");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "48");
    expect(img).toHaveAttribute("height", "48");
  });

  // The silhouette is the RESOLVED EMPTY state, not an error — decorative, aria-hidden.
  test("renders the aria-hidden silhouette span when hash is null (no img)", () => {
    const { container } = render(<Avatar hash={null} size={48} />);
    expect(container.querySelector("img")).toBeNull();
    const span = container.querySelector("span[aria-hidden]");
    expect(span).not.toBeNull();
    expect(span).toHaveAttribute("aria-hidden", "true");
  });

  test("renders the fallback initial instead of the silhouette when provided", () => {
    render(<Avatar hash={null} size={28} fallbackInitial="K" />);
    expect(screen.getByText("K")).toBeInTheDocument();
    expect(document.querySelector("svg")).toBeNull();
  });

  // ── Shape: one rule, all three branches. ────────────────────────────────
  test("all three branches are circular", () => {
    const img = render(<Avatar hash="abc123" size={48} />).container.querySelector("img")!;
    expect(img.className).toContain("rounded-full");

    const initial = render(<Avatar hash={null} size={48} fallbackInitial="K" />)
      .container.querySelector("span[aria-hidden]")!;
    expect(initial.className).toContain("rounded-full");

    const silhouette = render(<Avatar hash={null} size={48} />)
      .container.querySelector("span[aria-hidden]")!;
    expect(silhouette.className).toContain("rounded-full");
  });

  // ── Two-surface token rule (CLAUDE.md). RTL asserts the DOM, not contrast: ──
  // an unswapped variant renders present, functional and INVISIBLE with the suite
  // green. That is the v0.26.0 failure. This test is the only thing standing in
  // for a human looking at the masthead.
  test("variant=dark swaps the surface tokens on the image ring", () => {
    const img = render(<Avatar hash="abc123" size={36} variant="dark" />)
      .container.querySelector("img")!;
    expect(img.className).toContain("border-dark-edge-bright");
    expect(img.className).not.toContain("border-hairline");
  });

  test("variant=dark swaps the surface tokens on both fallback discs", () => {
    for (const el of [
      render(<Avatar hash={null} size={36} variant="dark" fallbackInitial="K" />)
        .container.querySelector("span[aria-hidden]")!,
      render(<Avatar hash={null} size={36} variant="dark" />)
        .container.querySelector("span[aria-hidden]")!,
    ]) {
      expect(el.className).toContain("border-dark-edge-bright");
      expect(el.className).toContain("bg-dark-well");
      expect(el.className).toContain("text-paper");
      expect(el.className).not.toContain("border-hairline");
      expect(el.className).not.toContain("bg-bone");
      expect(el.className).not.toContain("text-ink-muted");
    }
  });

  // `cn` is twMerge(clsx(...)), which resolves by Tailwind class GROUP rather than
  // appending. A caller-supplied border must REPLACE the component's own, not sit
  // beside it as a competing rule whose winner depends on stylesheet order.
  // The masthead hover depends on this being true.
  test("a caller className overrides the component's own token in the same group", () => {
    const img = render(<Avatar hash="abc123" size={36} className="border-red" />)
      .container.querySelector("img")!;
    expect(img.className).toContain("border-red");
    expect(img.className).not.toContain("border-hairline");
  });
});
