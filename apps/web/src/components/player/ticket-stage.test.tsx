import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// FitLine observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);
import { render, screen, within, cleanup } from "@testing-library/react";
import { TicketStage } from "./ticket-stage";
import type { PlayerPage, ServerStanding } from "@/lib/types";

const NOW = new Date("2026-07-30T12:00:00Z");

const aliveStanding = (over: Partial<ServerStanding> = {}): ServerStanding => ({
  serverId: 1,
  map: "chernarusplus",
  slug: "chernarus",
  state: "alive",
  alive: {
    lifeId: 1,
    lifeNumber: 7,
    startedAt: "2026-07-25T09:00:00Z",
    timeAliveSeconds: 90_000,
    kills: 2,
    longestKillMeters: 210,
    killList: [],
    qualified: true,
    qualifiedAt: null,
  },
  ban: null,
  lastLifeNumber: 6,
  lastEndedAt: "2026-07-25T08:00:00Z",
  ...over,
});

const bannedStanding = (): ServerStanding => ({
  serverId: 2,
  map: "enoch",
  slug: "livonia",
  state: "banned",
  alive: null,
  ban: {
    banId: 42,
    bannedAt: "2026-07-30T02:00:00Z",
    expiresAt: "2026-07-31T02:00:00Z",
    liftPending: false,
    triggeringLifeNumber: 11,
    verdict: null,
  },
  lastLifeNumber: 11,
  lastEndedAt: "2026-07-30T02:00:00Z",
});

const idleStanding = (over: Partial<ServerStanding> = {}): ServerStanding => ({
  serverId: 3,
  map: "namalsk",
  slug: "namalsk",
  state: "idle",
  alive: null,
  ban: null,
  lastLifeNumber: 3,
  lastEndedAt: "2026-07-22T12:00:00Z",
  ...over,
});

const makePage = (standing: ServerStanding[]): PlayerPage => ({
  gamertag: "Manicdote",
  verified: true,
  avatarHash: null,
  firstSeenAt: "2026-01-01T00:00:00Z",
  aliveAnywhere: standing.some((s) => s.state === "alive"),
  totals: { kills: 9, lives: 11, deaths: 10, longestLifeSeconds: 200_000 },
  previousBestSeconds: 50_000,
  standing,
  pastLives: [],
  pastLivesTotal: 0,
  pastLivesPage: 1,
  pastLivesPageSize: 10,
  obituaries: [],
  obituariesTotal: 0,
});

const page = makePage([aliveStanding(), bannedStanding(), idleStanding()]);

afterEach(cleanup);

describe("<TicketStage />", () => {
  it("uses the gamertag as the h1 in BOTH viewers", () => {
    render(<TicketStage page={page} viewer="public" now={NOW} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Manicdote");
    cleanup();
    render(<TicketStage page={page} viewer="owner" now={NOW} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Manicdote");
  });

  // The kicker was hardcoded "Survivor · verified", so every unclaimed gamertag on the board
  // advertised itself as a verified account. It must read the flag.
  it("only calls a player verified when they actually are", () => {
    render(<TicketStage page={page} viewer="public" now={NOW} />);
    expect(screen.getByText(/survivor · verified/i)).toBeInTheDocument();
    cleanup();
    render(<TicketStage page={makePage([idleStanding()])} viewer="public" now={NOW} />);
    expect(screen.getByText(/survivor · verified/i)).toBeInTheDocument();
    cleanup();
    render(
      <TicketStage page={{ ...makePage([idleStanding()]), verified: false }} viewer="public" now={NOW} />,
    );
    expect(screen.queryByText(/survivor · verified/i)).not.toBeInTheDocument();
    expect(screen.getByText(/survivor · unclaimed/i)).toBeInTheDocument();
  });

  it("renders one ticket per server, whether or not the player has played there", () => {
    render(<TicketStage page={page} viewer="public" now={NOW} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  // ⚠️ Timeline links are for LIVE tickets — alive and banned. An idle ticket says "No life", and
  // a card denying there is a life while linking to one contradicts itself. The fixture is
  // alive + banned + idle, so exactly two links.
  it("links out from alive and banned tickets, never from an idle one", () => {
    render(<TicketStage page={page} viewer="public" now={NOW} />);
    expect(screen.getAllByRole("link", { name: /timeline/i })).toHaveLength(2);
    const namalsk = screen.getByRole("listitem", { name: /namalsk/i }); // the idle ticket
    expect(within(namalsk).queryByRole("link", { name: /timeline/i })).not.toBeInTheDocument();
  });

  // An idle ticket WITH a history still refuses to link, and still reports the death that
  // ended it — the sub-line is the only place that fact appears.
  it("keeps the death report on an idle ticket while withholding the link", () => {
    render(<TicketStage page={page} viewer="owner" now={NOW} />);
    const namalsk = screen.getByRole("listitem", { name: /namalsk/i });
    expect(within(namalsk).getByText(/died .* life 3/i)).toBeInTheDocument();
    expect(within(namalsk).getByText(/^no life$/i)).toBeInTheDocument();
    expect(within(namalsk).queryByRole("link", { name: /timeline/i })).not.toBeInTheDocument();
  });

  // A never-played ticket is a THIRD state, distinct from idle-with-a-history. It says "Not
  // played" and stops: it used to stack "No life" over "Clear to spawn" over "Never played",
  // three restatements of nothing having happened.
  it("says 'Not played', and nothing more, for a server never played", () => {
    const neverPlayed = makePage([
      aliveStanding(),
      idleStanding({ lastLifeNumber: null, lastEndedAt: null }),
    ]);
    render(<TicketStage page={neverPlayed} viewer="owner" now={NOW} />);
    const namalsk = screen.getByRole("listitem", { name: /namalsk/i });
    expect(within(namalsk).getByText(/not played/i)).toBeInTheDocument();
    expect(within(namalsk).queryByText(/^no life$/i)).not.toBeInTheDocument();
    expect(within(namalsk).queryByText(/clear to spawn/i)).not.toBeInTheDocument();
    expect(within(namalsk).queryByText(/never played/i)).not.toBeInTheDocument();
    expect(within(namalsk).queryByRole("link", { name: /timeline/i })).not.toBeInTheDocument();
  });

  it("offers Spend only to the owner, and only on a banned ticket", () => {
    const { rerender } = render(<TicketStage page={page} viewer="public" now={NOW} />);
    expect(screen.queryByRole("button", { name: /spend 1 token/i })).not.toBeInTheDocument();
    rerender(<TicketStage page={page} viewer="owner" now={NOW} />);
    expect(screen.getAllByRole("button", { name: /spend 1 token/i })).toHaveLength(1);
  });

  it("never renders an unqualified life as qualified", () => {
    const grace = makePage([
      aliveStanding({
        alive: { ...aliveStanding().alive!, qualified: false, timeAliveSeconds: 120 },
      }),
    ]);
    render(<TicketStage page={grace} viewer="owner" now={NOW} />);
    expect(screen.getByText(/not yet qualified/i)).toBeInTheDocument();
    expect(screen.queryByText(/^alive$/i)).not.toBeInTheDocument();
  });

  it("shows no pencil to the public viewer", () => {
    render(<TicketStage page={page} viewer="public" now={NOW} />);
    expect(screen.queryByRole("button", { name: /update your photo/i })).not.toBeInTheDocument();
  });
});
