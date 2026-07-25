import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import Home from "./page";

// live-data honesty spec §5: a feed-fetch failure must not render identically to "the desk
// hasn't published yet." Home() is an async server component; we call and await it directly
// (it is just a function that returns JSX) rather than going through Next.js' render pipeline.
const getSurvivors = vi.fn();
const getServers = vi.fn();
const getLastPlayedMap = vi.fn();
vi.mock("@/lib/api", () => ({
  getSurvivors: (...a: unknown[]) => getSurvivors(...a),
  getServers: (...a: unknown[]) => getServers(...a),
  getLastPlayedMap: (...a: unknown[]) => getLastPlayedMap(...a),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => ({ kind: "loading" }) }));
// The account surface has its own data layer and its own tests. This file is about feed honesty,
// so stub the two account regions rather than mocking every query they reach for.
vi.mock("@/components/account/account-panels", () => ({
  AccountPanels: () => <section aria-label="Your account" />,
}));
vi.mock("@/components/account/home-sidebar", () => ({ HomeSidebar: () => <aside /> }));

const survivor = {
  gamertag: "boots", slug: "chernarus", map: "chernarusplus", timeAliveSeconds: 100,
  killsThisLife: 0, longestKillMeters: null, character: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getServers.mockResolvedValue([{ id: 1, name: "Chernarus", map: "chernarusplus", slug: "chernarus" }]);
  getLastPlayedMap.mockResolvedValue({ slug: null });
});

describe("Home page: a feed-fetch error is not the same as genuine emptiness", () => {
  test("a genuinely empty (resolved) survivors board shows its own quiet-coast copy, no banner", async () => {
    getSurvivors.mockResolvedValue({ rows: [], page: 1, pageSize: 5, total: 0 });
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.getByText("THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.")).toBeInTheDocument();
    expect(screen.queryByText(/temporarily unreachable/i)).not.toBeInTheDocument();
  });

  test("a REJECTED survivors fetch shows a distinguishing banner", async () => {
    getSurvivors.mockRejectedValue(new Error("503"));
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.getByText(/survivors board is temporarily unreachable/i)).toBeInTheDocument();
  });

  test("the board strip names the map it is scoped to", async () => {
    // ⚠️ There is no combined board (sub-project D), so an unlabelled top-5 would be silently
    // partial — it is one map's, and says so.
    getSurvivors.mockResolvedValue({ rows: [survivor], page: 1, pageSize: 5, total: 1 });
    render(await Home());
    expect(screen.getByText(/Still breathing on Chernarus/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ALL →" })).toHaveAttribute("href", "/survivors/chernarus");
  });

  test("the board is fetched for the resolved map, never a combined board", async () => {
    getSurvivors.mockResolvedValue({ rows: [survivor], page: 1, pageSize: 5, total: 1 });
    render(await Home());
    expect(getSurvivors).toHaveBeenCalledWith({ slug: "chernarus", page: 1 });
  });

  test("the last-played tier is honoured when it names a live server", async () => {
    getServers.mockResolvedValue([
      { id: 1, name: "Chernarus", map: "chernarusplus", slug: "chernarus" },
      { id: 2, name: "Sakhal", map: "sakhal", slug: "sakhal" },
    ]);
    getLastPlayedMap.mockResolvedValue({ slug: "sakhal" });
    getSurvivors.mockResolvedValue({ rows: [], page: 1, pageSize: 5, total: 0 });
    render(await Home());
    expect(getSurvivors).toHaveBeenCalledWith({ slug: "sakhal", page: 1 });
  });

  // ⚠️ Losing the last-played HINT must not cost the strip — it degrades to the alphabetical
  // tier, which is what a signed-out visitor gets anyway. A shared try/catch around both fetches
  // would take the board down with it.
  test("a failed last-played fetch still resolves a board", async () => {
    getLastPlayedMap.mockRejectedValue(new Error("503"));
    getSurvivors.mockResolvedValue({ rows: [survivor], page: 1, pageSize: 5, total: 1 });
    render(await Home());
    expect(getSurvivors).toHaveBeenCalledWith({ slug: "chernarus", page: 1 });
    expect(screen.queryByText(/temporarily unreachable/i)).not.toBeInTheDocument();
  });

  // ⚠️ A failed SERVERS fetch genuinely does cost the strip — there is no map to ask a board
  // about. What must NOT happen is it rendering as an empty coast: "nobody is alive" is a claim
  // about the game, and a network error is not evidence for it.
  test("a failed servers fetch reports a failure rather than an empty coast", async () => {
    getServers.mockRejectedValue(new Error("503"));
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.getByText(/survivors board is temporarily unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText("THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.")).not.toBeInTheDocument();
    expect(getSurvivors).not.toHaveBeenCalled();
  });
});
