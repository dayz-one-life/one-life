import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import Home from "./page";

// live-data honesty spec §5: a feed-fetch failure must not render identically to "the desk
// hasn't published yet." Home() is an async server component; we call and await it directly
// (it is just a function that returns JSX) rather than going through Next.js' render pipeline.
const getSurvivors = vi.fn();
const getServers = vi.fn();
vi.mock("@/lib/api", () => ({
  getSurvivors: (...a: unknown[]) => getSurvivors(...a),
  getServers: (...a: unknown[]) => getServers(...a),
}));
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => ({ kind: "loading" }) }));
// The account surface has its own data layer and its own tests. This file is about feed honesty,
// so stub the two account regions rather than mocking every query they reach for.
vi.mock("@/components/account/account-panels", () => ({
  AccountPanels: () => <section aria-label="Your account" />,
}));
vi.mock("@/components/account/home-sidebar", () => ({ HomeSidebar: () => <aside /> }));

beforeEach(() => {
  vi.clearAllMocks();
  getServers.mockResolvedValue([{ id: 1, name: "Chernarus", map: "chernarusplus", slug: "chernarus" }]);
});

describe("Home page: a feed-fetch error is not the same as genuine emptiness", () => {
  test("a genuinely empty (resolved) survivors board shows its own quiet-coast copy, no banner", async () => {
    getSurvivors.mockResolvedValue({ rows: [], page: 1, pageSize: 5, total: 0 });
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.getByText("THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.")).toBeInTheDocument();
    expect(screen.queryByText(/temporarily unreachable/i)).not.toBeInTheDocument();
  });

  test("a REJECTED survivors fetch shows a distinguishing banner (still renders the quiet-coast copy underneath)", async () => {
    getSurvivors.mockRejectedValue(new Error("503"));
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.getByText(/survivors board is temporarily unreachable/i)).toBeInTheDocument();
    expect(screen.getByText("THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.")).toBeInTheDocument();
  });

  // ⚠️ The two fetches must degrade INDEPENDENTLY. A single shared try/catch (or one awaited
  // sequentially so the first rejection skips the second) still passes the two tests above while
  // silently costing the other half of the page.
  test("a failed servers fetch does not take the survivors board down with it", async () => {
    getSurvivors.mockResolvedValue({
      rows: [{ gamertag: "boots", slug: "boots", map: "chernarusplus", timeAliveSeconds: 100, kills: 0, longestKillMeters: null, characterClass: null, serverName: "Chernarus", lifeNumber: 1 }],
      page: 1, pageSize: 5, total: 1,
    });
    getServers.mockRejectedValue(new Error("503"));
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.queryByText(/survivors board is temporarily unreachable/i)).not.toBeInTheDocument();
    expect(screen.getByText(/boots/i)).toBeInTheDocument();
  });

  test("a failed survivors fetch does not take the server list down with it", async () => {
    getSurvivors.mockRejectedValue(new Error("503"));
    render(await Home());
    // ColdFork renders only for a signed-out visitor and this file stubs status to `loading`, so
    // assert the survivors banner alone — the point is that Home still resolves and renders.
    expect(screen.getByText(/survivors board is temporarily unreachable/i)).toBeInTheDocument();
    expect(getServers).toHaveBeenCalled();
  });
});
