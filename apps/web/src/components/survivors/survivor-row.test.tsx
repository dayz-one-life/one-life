import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SurvivorRow } from "./survivor-row";

const base: {
  gamertag: string;
  map: string;
  slug: string;
  timeAliveSeconds: number;
  killsThisLife: number;
  longestKillMeters: number | null;
  avatarHash: string | null;
} = {
  gamertag: "Chad",
  map: "chernarusplus",
  slug: "chernarus",
  timeAliveSeconds: 24180,
  killsThisLife: 11,
  longestKillMeters: 341,
  avatarHash: null,
};

function row(overrides: Partial<typeof base> = {}) {
  return { ...base, ...overrides };
}

describe("SurvivorRow", () => {
  // Portraits are decorative (aria-hidden silhouette/initial disc) so they have no img/no role —
  // query the DOM directly.
  test("hero row (rank 1) shows the avatar, stat label, and the kills flourish", () => {
    const { container } = render(<SurvivorRow rank={1} row={base} />);
    const avatar = container.querySelector('span[aria-hidden="true"].bg-bone')!;
    expect(avatar).toHaveStyle({ width: "96px", height: "96px" });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Time alive")).toBeInTheDocument();
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
    expect(screen.getByText("11 kills")).toBeInTheDocument();
  });

  test("hero portrait is 96px", () => {
    render(<ol><SurvivorRow row={row({ avatarHash: "h1" })} rank={1} /></ol>);
    expect(document.querySelector('img[width="96"]')).not.toBeNull();
  });

  test("hero row omits the kills flourish at zero kills", () => {
    render(<SurvivorRow rank={1} row={{ ...base, killsThisLife: 0 }} />);
    expect(screen.queryByText(/kills/)).not.toBeInTheDocument();
  });

  test("podium row (rank 2) has a 60px avatar and no stat label", () => {
    const { container } = render(<SurvivorRow rank={2} row={base} />);
    const avatar = container.querySelector('span[aria-hidden="true"].bg-bone')!;
    expect(avatar).toHaveStyle({ width: "60px", height: "60px" });
    expect(screen.queryByText("Time alive")).not.toBeInTheDocument();
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
  });

  // Tier cut widened: rank 5 is still podium (avatar-account-pass spec §6).
  test("podium row (rank 5) still has a 60px avatar", () => {
    const { container } = render(<SurvivorRow rank={5} row={base} />);
    const avatar = container.querySelector('span[aria-hidden="true"].bg-bone')!;
    expect(avatar).toHaveStyle({ width: "60px", height: "60px" });
  });

  test("compact row (rank 6) carries a 28px avatar disc", () => {
    const { container } = render(<SurvivorRow rank={6} row={base} />);
    const avatar = container.querySelector('span[aria-hidden="true"].bg-bone')!;
    expect(avatar).toHaveStyle({ width: "28px", height: "28px" });
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
  });

  test("compact rows carry a 28px avatar disc", () => {
    render(<ol><SurvivorRow row={row({ avatarHash: "h2" })} rank={7} /></ol>);
    expect(document.querySelector('img[width="28"]')).not.toBeNull();
  });

  test("a hash-less compact row shows the initial disc, never an empty slot", () => {
    render(<ol><SurvivorRow row={row({ gamertag: "Khushie", avatarHash: null })} rank={9} /></ol>);
    expect(screen.getByText("K")).toBeInTheDocument();
  });

  // ⚠️ Every board is a single map now, so naming the map on every row would be noise. The map
  // lives in the page heading and the tabs.
  test("no row shows the map slug", () => {
    for (const rank of [1, 2, 6]) {
      const { unmount } = render(<SurvivorRow rank={rank} row={base} />);
      expect(screen.queryByText("chernarus")).not.toBeInTheDocument();
      unmount();
    }
  });

  // ⚠️ One ranking: time alive. Kills and longest kill are TIE-BREAKS in the read-model, never
  // the displayed stat — a row showing "341m" would be reporting a sort that no longer exists.
  test("the stat is always time alive, never kills or longest kill", () => {
    render(<SurvivorRow rank={6} row={base} />);
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
    expect(screen.queryByText("341m")).not.toBeInTheDocument();
    expect(screen.queryByText("11")).not.toBeInTheDocument();
  });

  test("a null longest kill is simply never rendered", () => {
    render(<SurvivorRow rank={5} row={{ ...base, longestKillMeters: null }} />);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
  });

  test("gamertag links to the player page", () => {
    render(<SurvivorRow rank={3} row={base} />);
    expect(screen.getByRole("link", { name: "Chad" })).toHaveAttribute("href", "/players/chad");
  });

  // `truncate` (overflow:hidden + text-overflow:ellipsis) is a no-op on the anchor's default
  // `display:inline` box — it needs a block-level display utility to actually engage.
  test("hero row gamertag link is block-level so truncate can engage", () => {
    render(<SurvivorRow rank={1} row={base} />);
    const link = screen.getByRole("link", { name: "Chad" }).className;
    expect(link).toContain("truncate");
    expect(link).toContain("block");
  });

  test("podium row gamertag link is block-level so truncate can engage", () => {
    render(<SurvivorRow rank={2} row={base} />);
    expect(screen.getByRole("link", { name: "Chad" }).className).toContain("block");
  });

  test("compact row gamertag link is inline-block with a max width so truncate can engage", () => {
    render(<SurvivorRow rank={6} row={base} />);
    const link = screen.getByRole("link", { name: "Chad" }).className;
    expect(link).toContain("inline-block");
    expect(link).toContain("max-w-full");
  });

  test("hero row renders an img when avatarHash is present", () => {
    const { container } = render(<SurvivorRow rank={1} row={{ ...base, avatarHash: "cafe1234feed5678" }} />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "/api/avatars/cafe1234feed5678.webp");
    expect(container.querySelector('span[aria-hidden="true"].bg-bone')).toBeNull();
  });

  test("podium row renders an img when avatarHash is present", () => {
    const { container } = render(<SurvivorRow rank={2} row={{ ...base, avatarHash: "cafe1234feed5678" }} />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/avatars/cafe1234feed5678.webp");
  });

  // The silhouette is replaced on this board — every row shows an initial disc when hash-less.
  test("hero row renders the initial disc, never the silhouette, when avatarHash is null", () => {
    const { container } = render(<SurvivorRow rank={1} row={{ ...base, avatarHash: null }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector('span[aria-hidden="true"].bg-bone')).not.toBeNull();
    expect(screen.getByText("C")).toBeInTheDocument();
  });
});
