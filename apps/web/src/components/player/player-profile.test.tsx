import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// FitLine observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);
import { PlayerProfile } from "./player-profile";
import type { PlayerPage, ServerStanding, PastLife } from "@/lib/types";

function renderProfile(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const standing = (serverId: number, state: ServerStanding["state"] = "alive"): ServerStanding => ({
  serverId,
  map: serverId === 1 ? "chernarusplus" : "sakhal",
  slug: serverId === 1 ? "chernarus" : "sakhal",
  state,

  alive:
    state === "alive"
      ? { lifeId: serverId, lifeNumber: 1, startedAt: "2026-07-01T00:00:00Z", timeAliveSeconds: 3600, kills: 0, longestKillMeters: null, killList: [], qualified: true, qualifiedAt: { at: "2026-07-01T00:05:00Z", by: "playtime" } }
      : null,
  ban: null,
  lastLifeNumber: null, lastEndedAt: null,
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

  death: { cause: null, byGamertag: null, weapon: null, distanceMeters: null, verdict: null },
  vitals: { energy: null, water: null, bleedSources: null },
  sessions: 1,
  killList: [],
});

function page(overrides: Partial<PlayerPage> = {}): PlayerPage {
  return {
    gamertag: "YrJustBad",
    verified: true,
    avatarHash: null,
    firstSeenAt: "2026-07-01T00:00:00Z",
    aliveAnywhere: true,
    totals: { kills: 2, lives: 4, deaths: 2, longestLifeSeconds: 82440 },
    previousBestSeconds: 0,
    standing: [standing(1), standing(2)],
    pastLives: [pastLife(1), pastLife(2), pastLife(3)],
    pastLivesTotal: 3,
    pastLivesPage: 1,
    pastLivesPageSize: 10,
    obituaries: [
      {
        slug: "yrjustbad-chernarus-1",
        map: "chernarusplus",
        mapSlug: "chernarus",
        lifeNumber: 1,
        headline: "A trade at the coast",
        lede: null,
        deathAt: "2026-06-02T00:00:00Z",
        timeAliveSeconds: 3600,
        kills: 0,
        longestKillMeters: null,
        cause: "pvp",
      },
    ],
    obituariesTotal: 1,
    ...overrides,
  };
}

const NOW = new Date("2026-07-20T12:00:00Z");

describe("PlayerProfile", () => {
  test("leads with the ticket stage and ends with the morgue", () => {
    renderProfile(<PlayerProfile page={page()} now={NOW} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("YrJustBad");
    expect(screen.getByText(/obituar(y|ies) filed/i)).toBeInTheDocument();
  });

  test("shows no owner affordances to a stranger", () => {
    renderProfile(<PlayerProfile page={page()} now={NOW} />);
    expect(screen.queryByRole("button", { name: /spend 1 token/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Your invite link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update your photo/i })).not.toBeInTheDocument();
  });

  test("renders one ticket per server, each with its own timeline link", () => {
    renderProfile(<PlayerProfile page={page()} now={NOW} />);
    // The first list on the page is the stage's ticket row; the morgue renders its own below.
    const tickets = screen.getAllByRole("list")[0]!;
    expect(within(tickets).getAllByRole("listitem")).toHaveLength(page().standing.length);
    expect(within(tickets).getAllByRole("link", { name: /timeline/i }).length).toBeGreaterThan(0);
  });

  // The strip sits between the dark masthead and the dark stage. It shipped light, which painted
  // a white bar across the top of every dossier. RTL can't see the paint, but it can pin the
  // token choice — a dark surface with a dark-surface link colour, and no top padding pushing
  // the page away from the masthead.
  test("carries the back-link on a dark strip flush against the masthead", () => {
    const { container } = renderProfile(<PlayerProfile page={page()} now={NOW} />);
    const back = screen.getByRole("link", { name: /survivors/i });
    const strip = back.parentElement!;
    expect(strip.className).toContain("bg-dark");
    expect(back.className).toContain("text-cream-muted");
    expect(back.className).not.toContain("text-ink-muted");
    expect(container.querySelector("main")!.className).not.toMatch(/(^|\s)py-10(\s|$)/);
  });

  test("keeps the totals strip", () => {
    renderProfile(<PlayerProfile page={page()} now={NOW} />);
    expect(screen.getByText("Deaths")).toBeInTheDocument();
    expect(screen.getByText("Longest life")).toBeInTheDocument();
  });
});
