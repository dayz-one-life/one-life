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

  it("is the z-40 layer on this route, where there is no masthead", () => {
    // LAYER LEGEND (components/header.tsx): content -> z-40 chrome -> z-50 overlays.
    // jsdom cannot observe paint order, so pin the altitude numerically.
    const { container } = render(<TopBar slug="chernarus" servers={servers} serversLoading={false} />);
    const bar = container.querySelector("header")!;
    expect(bar.className).toMatch(/\bz-40\b/);
    expect(bar.className).not.toMatch(/\bz-(?:5\d|[6-9]\d)\b/);
  });
});
