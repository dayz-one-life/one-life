import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "./top-bar";

const servers = [{ slug: "chernarus", name: "Chernarus", map: "chernarusplus", friendCount: 1 }];

describe("TopBar", () => {
  it("always offers a way off the map — the shell has no other exit", () => {
    render(<TopBar slug="chernarus" servers={servers} serversLoading={false} />);
    expect(screen.getByRole("link", { name: /back|one life/i })).toHaveAttribute("href", "/");
  });

  it("renders its control cluster", () => {
    render(
      <TopBar slug="chernarus" servers={servers} serversLoading={false}>
        <button type="button">Locate</button>
      </TopBar>,
    );
    expect(screen.getByRole("button", { name: "Locate" })).toBeInTheDocument();
  });

  it("uses the real wordmark, with intrinsic dimensions so the bar cannot shift", () => {
    render(<TopBar slug="chernarus" servers={servers} serversLoading={false} />);
    const img = screen.getByRole("link", { name: "Back to One Life" }).querySelector("img")!;
    expect(img).toHaveAttribute("src", expect.stringContaining("wordmark"));
    expect(img).toHaveAttribute("width");
    expect(img).toHaveAttribute("height");
  });

  it("names the way out exactly once", () => {
    // An alt of "One Life" on top of the link's own aria-label makes the accessible name
    // "Back to One Life One Life".
    render(<TopBar slug="chernarus" servers={servers} serversLoading={false} />);
    expect(screen.getByRole("link", { name: "Back to One Life" })).toBeInTheDocument();
    expect(screen.queryByAltText("One Life")).toBeNull();
  });

  it("holds a real touch floor on the way out", () => {
    // 52, not the 44px accessibility minimum: 44 was measured on a phone and still read as
    // fiddly. jsdom has no layout, so this pins the intent; the phone pass judges the result.
    render(<TopBar slug="chernarus" servers={servers} serversLoading={false} />);
    expect(screen.getByRole("link", { name: "Back to One Life" }).className).toMatch(/min-h-\[52px\]/);
  });

  it("has no arrow beside the wordmark — the wordmark is the way home", () => {
    render(<TopBar slug="chernarus" servers={servers} serversLoading={false} />);
    expect(screen.getByRole("link", { name: "Back to One Life" }).textContent).toBe("");
  });

  it("is the z-40 layer on this route, where there is no masthead", () => {
    // LAYER LEGEND (components/header.tsx): content -> z-40 chrome -> z-50 overlays.
    // jsdom cannot observe paint order, so pin the altitude numerically.
    const { container } = render(<TopBar slug="chernarus" servers={servers} serversLoading={false} />);
    const bar = container.querySelector("header")!;
    expect(bar.className).toMatch(/\bz-40\b/);
    expect(bar.className).not.toMatch(/\bz-(?:5\d|[6-9]\d)\b/);
  });
});
