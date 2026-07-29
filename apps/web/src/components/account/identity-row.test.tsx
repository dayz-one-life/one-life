import { render, screen } from "@testing-library/react";
import { describe, expect, it, test } from "vitest";
import { IdentityRow } from "./identity-row";

describe("IdentityRow", () => {
  test("verified: name, provider line, stamp", () => {
    render(<IdentityRow name="BootsColdwater" provider="discord" verified />);
    expect(screen.getByText("BootsColdwater")).toBeInTheDocument();
    expect(screen.getByText("Via discord")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });
  test("unlinked: tag line joins the provider, no stamp", () => {
    render(<IdentityRow name="boots" provider="discord" tagLine="No gamertag" />);
    expect(screen.getByText("Via discord · No gamertag")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
  test("avatar disc is decorative", () => {
    const { container } = render(<IdentityRow name="Boots" provider={null} />);
    const disc = container.querySelector('[aria-hidden="true"]');
    expect(disc?.textContent).toBe("B");
  });
  it("renders the real avatar when a hash is present, lettered disc otherwise", () => {
    const { container, rerender } = render(<IdentityRow name="Rusty" provider="discord" avatarHash="abc123def4567890" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/api/avatars/abc123def4567890.webp");
    // Decorative: the letter disc it replaces was aria-hidden; the image stays out of the a11y tree too.
    expect(img!.getAttribute("alt")).toBe("");

    rerender(<IdentityRow name="Rusty" provider="discord" avatarHash={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("R"); // the lettered fallback
  });

  it("renders the avatar through the shared Avatar, circular, on the paper variant", () => {
    const { container, rerender } = render(<IdentityRow name="Rusty" provider="discord" avatarHash="abc123def4567890" />);
    const img = container.querySelector("img")!;
    expect(img.className).toContain("rounded-full");
    expect(img.className).toContain("border-hairline");
    expect(img.className).toContain("flex-none"); // survives the collapse; it sits in a flex row

    rerender(<IdentityRow name="Rusty" provider="discord" avatarHash={null} />);
    const disc = container.querySelector('[aria-hidden="true"]')!;
    expect(disc.className).toContain("rounded-full");
    // Accepted visual change (spec §3.3): the bespoke bg-discord blurple disc is gone.
    expect(disc.className).toContain("bg-bone");
    expect(disc.className).not.toContain("bg-discord");
  });
});
