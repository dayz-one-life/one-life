import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// FitLine observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

const playerQuery = { data: undefined as unknown, isError: false, isLoading: true };
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === "player-page") return playerQuery;
    if (queryKey[0] === "servers") return { data: [], isLoading: false, isError: false };
    return { data: { joined: 2 }, isLoading: false, isError: false };
  },
}));
vi.mock("./use-controls", () => ({
  useControls: () => ({
    status: { kind: "verified", link: { gamertag: "Manicdote" } },
    balance: 3,
    balanceLoading: false,
  }),
  useControlsActions: () => ({ send: { mutate: vi.fn(), isPending: false } }),
}));

const { VerifiedHome } = await import("./verified-home");

const page = {
  gamertag: "Manicdote",
  verified: true,
  avatarHash: null,
  firstSeenAt: null,
  aliveAnywhere: false,
  totals: { kills: 0, lives: 0, deaths: 0, longestLifeSeconds: 0 },
  previousBestSeconds: 0,
  standing: [
    {
      serverId: 1, map: "chernarusplus", slug: "chernarus", state: "idle",
      alive: null, ban: null, lastLifeNumber: 4, lastEndedAt: "2026-07-20T00:00:00Z",
    },
  ],
  pastLives: [], pastLivesTotal: 0, pastLivesPage: 1, pastLivesPageSize: 10,
  obituaries: [], obituariesTotal: 0,
};

beforeEach(() => {
  playerQuery.data = page;
  playerQuery.isError = false;
  playerQuery.isLoading = false;
  vi.stubGlobal("location", { origin: "https://dayzonelife.com" });
});
afterEach(cleanup);

describe("<VerifiedHome />", () => {
  it("gives a verified player the ticket stage and the controls slab", () => {
    render(<VerifiedHome gamertag="Manicdote" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Manicdote");
    expect(screen.getByLabelText("Your invite link")).toBeInTheDocument();
  });

  it("still renders the controls and the morgue when the standing feed fails", () => {
    playerQuery.data = undefined;
    playerQuery.isError = true;
    playerQuery.isLoading = false;
    render(<VerifiedHome gamertag="Manicdote" />);
    // The stage says it couldn't load — and does NOT claim the player has no servers…
    expect(screen.getByText(/couldn.t load your standing/i)).toBeInTheDocument();
    // …the morgue says the same for itself, rather than "no obituary has been filed"…
    expect(screen.queryByText(/no obituary has been filed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t load the obituaries/i)).toBeInTheDocument();
    // …and the controls slab, which has its own queries, is untouched.
    expect(screen.getByLabelText("Your invite link")).toBeInTheDocument();
  });

  it("offers the connect panel only when a server is actually clear to spawn", () => {
    const { rerender } = render(<VerifiedHome gamertag="Manicdote" />);
    expect(document.querySelector("#connect")).toBeTruthy(); // fixture standing is idle
    playerQuery.data = { ...page, standing: [{ ...page.standing[0], state: "banned" }] };
    rerender(<VerifiedHome gamertag="Manicdote" />);
    expect(document.querySelector("#connect")).toBeNull();
  });

  // The connect beat is the SAME universal `JoinServers` slab every other surface renders. This
  // page shipped with the older text-only "How to connect" panel instead — the exact drift the
  // one-component rule exists to stop — so pin the shared slab by its own landmark.
  it("uses the universal Join-the-servers slab, not a home-only connect panel", () => {
    render(<VerifiedHome gamertag="Manicdote" />);
    expect(screen.getByRole("region", { name: "Join the servers" })).toBeInTheDocument();
    expect(screen.getByTestId("browser-replica")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /how to connect/i })).not.toBeInTheDocument();
  });

  it("never renders an authoritative empty morgue while the fetch is in flight", () => {
    playerQuery.data = undefined;
    playerQuery.isError = false;
    playerQuery.isLoading = true;
    render(<VerifiedHome gamertag="Manicdote" />);
    expect(screen.queryByText(/no obituary has been filed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/obituar(y|ies) filed/i)).not.toBeInTheDocument();
  });
});
