import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PlayerProfile } from "./player-profile";
import type { PlayerPage, ServerStanding, PastLife } from "@/lib/types";

const standing = (serverId: number, state: ServerStanding["state"] = "alive"): ServerStanding => ({
  serverId,
  map: serverId === 1 ? "chernarusplus" : "sakhal",
  slug: serverId === 1 ? "chernarus" : "sakhal",
  state,
  character: null,
  alive:
    state === "alive"
      ? { lifeId: serverId, lifeNumber: 1, startedAt: "2026-07-01T00:00:00Z", timeAliveSeconds: 3600, kills: 0, longestKillMeters: null, killList: [] }
      : null,
  ban: null,
  lastLifeNumber: null,
});

const pastLife = (lifeId: number): PastLife => ({
  lifeId,
  serverId: 1,
  map: "chernarusplus",
  slug: "chernarus",
  lifeNumber: lifeId,
  startedAt: "2026-06-01T00:00:00Z",
  endedAt: "2026-06-02T00:00:00Z",
  timeAliveSeconds: 3600,
  kills: 0,
  longestKillMeters: null,
  character: null,
  death: { cause: null, byGamertag: null, weapon: null, distanceMeters: null, verdict: null },
  vitals: { energy: null, water: null, bleedSources: null },
  sessions: 1,
  killList: [],
});

function page(overrides: Partial<PlayerPage> = {}): PlayerPage {
  return {
    gamertag: "YrJustBad",
    verified: true,
    firstSeenAt: "2026-07-01T00:00:00Z",
    aliveAnywhere: true,
    totals: { kills: 2, lives: 4, deaths: 2, longestLifeSeconds: 82440 },
    standing: [standing(1), standing(2)],
    pastLives: [pastLife(1), pastLife(2), pastLife(3)],
    pastLivesTotal: 3,
    pastLivesPage: 1,
    pastLivesPageSize: 10,
    ...overrides,
  };
}

const NOW = new Date("2026-07-20T12:00:00Z");

describe("PlayerProfile", () => {
  test("Current standing is a list — one listitem per card, grid classes + list-none preserved", () => {
    render(<PlayerProfile page={page()} now={NOW} articles={null} articlesFailed={false} articlesPage={1} />);
    const heading = screen.getByRole("heading", { name: "Current standing" });
    const section = heading.closest("section")!;
    const list = within(section).getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(list.className).toContain("grid");
    expect(list.className).toContain("md:grid-cols-2");
    expect(list.className).toContain("gap-5");
    expect(list.className).toContain("list-none");
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(page().standing.length);
    // Each <li> must itself be a grid item (a single-child grid item defaults to
    // align-items/justify-items: stretch), so the <section> card inside fills it and the
    // whole row aligns to equal height — the grid ITEM lives on the <li>, not the card.
    for (const item of items) expect(item.className).toContain("grid");
  });

  test("Past lives is a separate list — one listitem per funeral card, grid classes + list-none preserved", () => {
    render(<PlayerProfile page={page()} now={NOW} articles={null} articlesFailed={false} articlesPage={1} />);
    const heading = screen.getByRole("heading", { name: /Past lives/ });
    const section = heading.closest("section")!;
    const list = within(section).getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(list.className).toContain("grid");
    expect(list.className).toContain("md:grid-cols-2");
    expect(list.className).toContain("gap-5");
    expect(list.className).toContain("list-none");
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(page().pastLives.length);
    // Same equal-height constraint as the standing list — see the comment there.
    for (const item of items) expect(item.className).toContain("grid");
  });

  test("Current standing section is omitted when everyone is idle — no stray list", () => {
    render(<PlayerProfile page={page({ standing: [standing(1, "idle")] })} now={NOW} articles={null} articlesFailed={false} articlesPage={1} />);
    expect(screen.queryByRole("heading", { name: "Current standing" })).not.toBeInTheDocument();
  });

  test("In The Paper mounts between current standing and past lives, and its pagination preserves the past-lives page", () => {
    render(
      <PlayerProfile
        page={page()}
        now={NOW}
        articles={{
          rows: Array.from({ length: 12 }, (_, i) => ({
            kind: "obituary",
            slug: `s${i}`,
            headline: `Headline ${i}`,
            createdAt: "2026-07-12T00:00:00Z",
            role: "subject" as const,
            mapSlug: "sakhal",
          })),
          total: 12,
          page: 1,
          pageSize: 10,
        }}
        articlesFailed={false}
        articlesPage={1}
      />,
    );
    const inThePaperHeading = screen.getByRole("heading", { name: "In The Paper" });
    const currentStandingHeading = screen.getByRole("heading", { name: "Current standing" });
    const pastLivesHeading = screen.getByRole("heading", { name: /Past lives/ });
    // DOM order: current standing, then In The Paper, then past lives.
    expect(
      currentStandingHeading.compareDocumentPosition(inThePaperHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      inThePaperHeading.compareDocumentPosition(pastLivesHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The papers pagination (ap=2) preserves the current past-lives page (page.pastLivesPage = 1, omitted).
    expect(screen.getByRole("navigation", { name: /in the paper pagination/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /older/i })).toHaveAttribute("href", "/players/yrjustbad?ap=2");
  });

  test("a failed articles fetch renders the status line, not an empty section", () => {
    render(<PlayerProfile page={page()} now={NOW} articles={null} articlesFailed articlesPage={1} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
