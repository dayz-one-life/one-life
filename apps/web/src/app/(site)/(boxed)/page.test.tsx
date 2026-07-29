import { render, screen } from "@testing-library/react";
import { describe, expect, test, it, vi, beforeEach, type Mock } from "vitest";
import Home from "./page";

// live-data honesty spec §5: a feed-fetch failure must not render identically to "the desk
// hasn't published yet." Home() is an async server component; we call and await it directly
// (it is just a function that returns JSX) rather than going through Next.js' render pipeline.
const getSurvivors = vi.fn();
const getServers = vi.fn();
const getLastPlayedMap = vi.fn();
const getObituariesFeed = vi.fn();
const getSiteStatsCached = vi.fn();
const getObituariesFeedCached = vi.fn();
vi.mock("@/lib/api", () => ({
  getSurvivors: (...a: unknown[]) => getSurvivors(...a),
  getServers: (...a: unknown[]) => getServers(...a),
  getLastPlayedMap: (...a: unknown[]) => getLastPlayedMap(...a),
  getObituariesFeed: (...a: unknown[]) => getObituariesFeed(...a),
  getSiteStatsCached: (...a: unknown[]) => getSiteStatsCached(...a),
  getObituariesFeedCached: (...a: unknown[]) => getObituariesFeedCached(...a),
}));
// Mutable cookie jar: [] = cold visitor (the default for these feed tests); push a
// `…session_token` cookie to simulate a signed-in visitor for the pitch-gating tests below.
const cookieJar: Array<{ name: string; value: string }> = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => cookieJar }),
}));
// `CtaSlab` renders only for `signedOut`, and `HomeShell`'s sidebar only for `verified` — this
// suite is about the cold pitch, so we drive the mocked cookie jar for fetch gating and pin
// `useAccountStatus` at `signedOut` so the pitch beats (Hero/Fallen/Rules/CtaSlab) render.
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => ({ kind: "signedOut" }) }));
// The account surface has its own data layer and its own tests. This file is about feed honesty,
// so stub the account region rather than mocking every query it reaches for.
vi.mock("@/components/account/account-panels", () => ({
  AccountPanels: () => <section aria-label="Your account" />,
}));
// The real PendingHero reaches TanStack mutation hooks that need a QueryClientProvider this
// suite deliberately doesn't mount. The real section carries id="claim" (pinned by
// pending-hero.test.tsx) — mirrored on the stub so this suite's anchor-structure assertions stay
// meaningful.
vi.mock("@/components/front-page/pending-hero", () => ({
  PendingHero: () => <section id="claim" data-testid="pending-hero-slot" />,
}));
// ClaimModal also reaches TanStack mutation hooks via useControlsActions, same reason as above —
// this suite is about page structure/fetch gating, not the modal (covered by claim-modal.test.tsx).
vi.mock("@/components/account/claim-modal", () => ({ ClaimModal: () => null }));

// FitLine mounts under jsdom and observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

// CountUp uses window.matchMedia for reduced-motion detection
global.matchMedia = vi.fn((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})) as any;

const survivor = {
  gamertag: "boots", slug: "chernarus", map: "chernarusplus", timeAliveSeconds: 100,
  killsThisLife: 0, longestKillMeters: null, avatarHash: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.length = 0;
  getServers.mockResolvedValue([{ id: 1, name: "Chernarus", map: "chernarusplus", slug: "chernarus" }]);
  getLastPlayedMap.mockResolvedValue({ slug: null });
  // Default: stats fetch fails, so Hero falls back to evergreen headline
  getSiteStatsCached.mockRejectedValue(new Error("unavailable"));
  // Default: obituaries fetch fails, so Fallen renders nothing — matching the getSiteStatsCached
  // pattern above (a REJECTED feed vs. a resolved-empty one are two distinct outcomes).
  getObituariesFeedCached.mockRejectedValue(new Error("no feed"));
});

// ⚠️ The pitch is for COLD visitors only (home-is-the-app spec): a signed-in player's home
// starts with their own standing. Signed-in is detected by session-cookie presence, so these
// drive the mocked cookie jar.
describe("Home page: the pitch renders for cold visitors only", () => {
  test("a session cookie suppresses the hero, the fallen wall and the CTA slab", async () => {
    cookieJar.push({ name: "__Secure-better-auth.session_token", value: "x" });
    getSurvivors.mockResolvedValue({ rows: [survivor], page: 1, pageSize: 5, total: 1 });
    render(await Home());
    expect(screen.queryByRole("heading", { level: 1, name: "One life. No respawns" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /The Fallen/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Claim it/i })).toBeNull();
    expect(screen.getByLabelText("Your account")).toBeInTheDocument();
  });

  test("no session cookie keeps the full cold landing", async () => {
    getObituariesFeedCached.mockResolvedValue({
      rows: [{
        slug: "yrjustbad-life-3", gamertag: "YrJustBad", map: "chernarusplus", mapSlug: "chernarus",
        lifeNumber: 3, headline: "Shot in the back on the Topolka dam", lede: "He had outlasted forty-one others.",
        tags: [], timeAliveSeconds: 112320, kills: 4, longestKillMeters: 210, cause: "pvp",
        deathAt: "2026-07-27T20:00:00Z",
      }],
      total: 1, page: 1, pageSize: 12,
    });
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns" })).toBeInTheDocument();
    // Rules render BEFORE the Fallen wall (spec §4).
    // ⚠️ Adapted from the brief's literal `html.indexOf("Death is real") < html.indexOf("The
    // Fallen")` check: the Fallen heading's text is split across a <span> ("The " + "Fallen"),
    // so that substring never appears contiguous in innerHTML and the indexOf comparison is
    // vacuously true (LHS < -1-turned-Infinity) regardless of actual order. DOM position
    // comparison exercises the same intent for real.
    const deathIsReal = screen.getByText("Death is real");
    const fallenHeading = screen.getByRole("heading", { name: /The Fallen/i });
    expect(
      deathIsReal.compareDocumentPosition(fallenHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a resolved stats fetch renders the casualty ledger as the h1", async () => {
    getSiteStatsCached.mockResolvedValue({ deaths: 3, alive: 2 });
    render(await Home());
    expect(
      screen.getByRole("heading", { level: 1, name: "Deaths to date: 3. Still standing: 2" }),
    ).toBeInTheDocument();
  });
});

describe("Home page: the claim anchor", () => {
  it("the account panels wrapper carries the #claim anchor for a signed-in render", async () => {
    cookieJar.push({ name: "__Secure-better-auth.session_token", value: "x" });
    getSurvivors.mockResolvedValue({ rows: [survivor], page: 1, pageSize: 5, total: 1 });
    const { container } = render(await Home());
    expect(container.querySelector("#claim")).not.toBeNull();
  });

  it("signed out: Join the servers precedes the CTA slab, which precedes the Fallen wall, and no account-panels wrapper renders", async () => {
    getObituariesFeedCached.mockResolvedValue({
      rows: [{
        slug: "yrjustbad-life-3", gamertag: "YrJustBad", map: "chernarusplus", mapSlug: "chernarus",
        lifeNumber: 3, headline: "Shot in the back on the Topolka dam", lede: "He had outlasted forty-one others.",
        tags: [], timeAliveSeconds: 112320, kills: 4, longestKillMeters: 210, cause: "pvp",
        deathAt: "2026-07-27T20:00:00Z",
      }],
      total: 1, page: 1, pageSize: 12,
    });
    const { container } = render(await Home());
    const joinHeading = screen.getByRole("heading", { level: 2, name: "Join the servers" });
    const claimHeading = screen.getByRole("heading", { name: /Claim it/i });
    const fallenHeading = screen.getByRole("heading", { name: /The Fallen/i });
    // Document order: Join → Claim → Fallen (beat order per the reorder task).
    expect(
      joinHeading.compareDocumentPosition(claimHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      claimHeading.compareDocumentPosition(fallenHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector("#claim")).toBeNull(); // wrapper (and anchor) absent when signed out
  });
});

describe("Home page: fetch gating (signed-out gets the pitch's feeds, signed-in gets the sidebar's)", () => {
  it("stats and obituaries come from the CACHED cookie-free fetchers in both cookie states", async () => {
    render(await Home());                       // signed out
    expect(getSiteStatsCached).toHaveBeenCalled();
    expect(getObituariesFeedCached).toHaveBeenCalledWith(1);
    expect(getObituariesFeed).not.toHaveBeenCalled();  // the cookie-forwarding fetcher must NOT serve home

    vi.clearAllMocks();
    getSiteStatsCached.mockRejectedValue(new Error("unavailable"));
    getObituariesFeedCached.mockRejectedValue(new Error("no feed"));
    cookieJar.push({ name: "__Secure-better-auth.session_token", value: "x" });
    getSurvivors.mockResolvedValue({ rows: [survivor], page: 1, pageSize: 5, total: 1 });
    render(await Home());                       // signed in
    expect(getSiteStatsCached).toHaveBeenCalled();
    expect(getObituariesFeedCached).toHaveBeenCalledWith(1);
    expect(getObituariesFeed).not.toHaveBeenCalled();
  });

  it("signed in: fetches survivors; signed out: does not", async () => {
    render(await Home()); // signed out
    expect(getSurvivors).not.toHaveBeenCalled();

    cookieJar.push({ name: "__Secure-better-auth.session_token", value: "x" });
    getSurvivors.mockResolvedValue({ rows: [survivor], page: 1, pageSize: 5, total: 1 });
    render(await Home());
    expect(getSurvivors).toHaveBeenCalled();
  });

  it("a resolved obituaries feed renders the Fallen wall", async () => {
    (getObituariesFeedCached as Mock).mockResolvedValue({
      rows: [{
        slug: "yrjustbad-life-3", gamertag: "YrJustBad", map: "chernarusplus", mapSlug: "chernarus",
        lifeNumber: 3, headline: "Shot in the back on the Topolka dam", lede: "He had outlasted forty-one others.",
        tags: [], timeAliveSeconds: 112320, kills: 4, longestKillMeters: 210, cause: "pvp",
        deathAt: "2026-07-27T20:00:00Z",
      }],
      total: 1, page: 1, pageSize: 12,
    });
    render(await Home());
    expect(screen.getByRole("heading", { name: /The Fallen/i })).toBeInTheDocument();
  });

  it("a failed obituaries feed renders no Fallen section and no error card", async () => {
    render(await Home()); // beforeEach default: rejected
    expect(screen.queryByRole("heading", { name: /The Fallen/i })).not.toBeInTheDocument();
  });
});

describe("Home page: pending-hero slot and anchor structure", () => {
  it("signed in: the ONE #claim anchor is PendingHero's own section — no wrapper div", async () => {
    cookieJar.push({ name: "__Secure-better-auth.session_token", value: "x" });
    getSurvivors.mockResolvedValue({ rows: [survivor], page: 1, pageSize: 5, total: 1 });
    const { container } = render(await Home());
    const claims = container.querySelectorAll("#claim");
    expect(claims).toHaveLength(1);
    const claim = claims[0]! as HTMLElement;
    expect(claim).toHaveAttribute("data-testid", "pending-hero-slot");
    // AccountPanels renders as a sibling, no longer nested inside a padded wrapper under #claim.
    expect(claim.querySelector("[aria-label='Your account']")).toBeNull();
    expect(screen.getByLabelText("Your account")).toBeInTheDocument();
  });

  it("signed out: no hero slot and no anchor", async () => {
    const { container } = render(await Home());
    expect(container.querySelector("#claim")).toBeNull();
    expect(container.querySelector("[data-testid='pending-hero-slot']")).toBeNull();
  });
});
