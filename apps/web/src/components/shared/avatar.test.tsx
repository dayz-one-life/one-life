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
});
