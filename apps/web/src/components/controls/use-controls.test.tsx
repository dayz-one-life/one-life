import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { useControls } from "./use-controls";

// live-data honesty spec §5: `standing` must not read as a resolved "idle" set while the
// player-page query (its source) is loading or errored. `standingLoading` is the signal
// consumers (rail.tsx/mobile-controls.tsx) route through to a loading affordance instead of
// fabricating per-server idle state from an empty `standing: []`.
vi.mock("@/lib/use-account-status", () => ({
  useAccountStatus: () => ({
    kind: "verified",
    link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
  }),
}));

const getMe = vi.fn();
const getTokens = vi.fn();
const getServers = vi.fn();
const getPlayerPage = vi.fn();
vi.mock("@/lib/api", () => ({
  getMe: (...a: unknown[]) => getMe(...a),
  getTokens: (...a: unknown[]) => getTokens(...a),
  getServers: (...a: unknown[]) => getServers(...a),
  getPlayerPage: (...a: unknown[]) => getPlayerPage(...a),
  redeemToken: vi.fn(),
  setReferrer: vi.fn(),
  transferToken: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  getMe.mockResolvedValue({ user: { name: "Boots" }, accounts: [] });
  getTokens.mockResolvedValue({ balance: 3 });
  getServers.mockResolvedValue([]);
});

describe("useControls: standing loading honesty", () => {
  test("player-page query unresolved: standingLoading is true (does not fabricate idle standing)", async () => {
    getPlayerPage.mockReturnValue(new Promise(() => {})); // never resolves in this test
    const { result } = renderHook(() => useControls(), { wrapper });
    await waitFor(() => expect(getPlayerPage).toHaveBeenCalled());
    expect(result.current.standingLoading).toBe(true);
    expect(result.current.standing).toEqual([]); // unresolved fallback shape, but flagged
  });

  test("player-page query errored: standingLoading is true", async () => {
    getPlayerPage.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useControls(), { wrapper });
    await waitFor(() => expect(result.current.standingLoading).toBe(true));
  });

  test("player-page query genuinely resolved empty: standingLoading is false", async () => {
    getPlayerPage.mockResolvedValue({ standing: [] });
    const { result } = renderHook(() => useControls(), { wrapper });
    await waitFor(() => expect(result.current.standingLoading).toBe(false));
    expect(result.current.standing).toEqual([]);
  });

  test("player-page query resolved with real standing: standingLoading is false and standing passes through", async () => {
    const standing = [{ serverId: 1, map: "chernarusplus", slug: "chernarus", state: "alive", character: null, alive: null, ban: null }];
    getPlayerPage.mockResolvedValue({ standing });
    const { result } = renderHook(() => useControls(), { wrapper });
    await waitFor(() => expect(result.current.standingLoading).toBe(false));
    expect(result.current.standing).toEqual(standing);
  });
});

// Fix round 1 (§5 coherence gap): `balance` is `tokens.data?.balance ?? null` off the same
// `["tokens"]` query — every consumer does `c.balance ?? 0`, fabricating a "0" while unresolved.
// `balanceLoading` mirrors `standingLoading` exactly, but gates on the tokens query's own
// `enabled` predicate (`signedIn`), not `gamertag !== null` (tokens is fetched for
// unlinked/pending too, standing is verified-only).
describe("useControls: balance loading honesty", () => {
  test("tokens query unresolved: balanceLoading is true (does not fabricate a resolved balance)", async () => {
    getTokens.mockReturnValue(new Promise(() => {})); // never resolves in this test
    getPlayerPage.mockResolvedValue({ standing: [] });
    const { result } = renderHook(() => useControls(), { wrapper });
    await waitFor(() => expect(getTokens).toHaveBeenCalled());
    expect(result.current.balanceLoading).toBe(true);
    expect(result.current.balance).toBeNull();
  });

  test("tokens query errored: balanceLoading is true", async () => {
    getTokens.mockRejectedValue(new Error("network down"));
    getPlayerPage.mockResolvedValue({ standing: [] });
    const { result } = renderHook(() => useControls(), { wrapper });
    await waitFor(() => expect(result.current.balanceLoading).toBe(true));
  });

  test("tokens query genuinely resolved to zero: balanceLoading is false and balance is a real 0", async () => {
    getTokens.mockResolvedValue({ balance: 0 });
    getPlayerPage.mockResolvedValue({ standing: [] });
    const { result } = renderHook(() => useControls(), { wrapper });
    await waitFor(() => expect(result.current.balanceLoading).toBe(false));
    expect(result.current.balance).toBe(0);
  });

  test("tokens query resolved with a positive balance: balanceLoading is false and balance passes through", async () => {
    getTokens.mockResolvedValue({ balance: 4 });
    getPlayerPage.mockResolvedValue({ standing: [] });
    const { result } = renderHook(() => useControls(), { wrapper });
    await waitFor(() => expect(result.current.balanceLoading).toBe(false));
    expect(result.current.balance).toBe(4);
  });
});
