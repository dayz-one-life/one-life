import { describe, expect, test, vi, beforeEach } from "vitest";
// FitLine (inside LifeHero) observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);
import { render, screen } from "@testing-library/react";
import type { LifeTimelineData } from "@/lib/types";

const getPlayerLife = vi.fn();
const getBlocks = vi.fn();
vi.mock("@/lib/api", () => ({
  getPlayerLife: (...a: unknown[]) => getPlayerLife(...a),
  getBlocks: (...a: unknown[]) => getBlocks(...a),
}));
// The timeline body and the location panel have their own suites and reach for client-only
// machinery this file does not mount. This suite is about ONE thing: whose face the hero renders.
vi.mock("@/components/life/timeline", () => ({ Timeline: () => <div data-testid="timeline" /> }));
vi.mock("@/components/life/location-panel", () => ({ LocationPanel: () => null }));

import LifePageRoute from "./page";

const START = "2026-07-14T00:00:00Z";
const HASH = "cafe1234feed5678";

function lifeData(): LifeTimelineData {
  return {
    gamertag: "YrJustBad", map: "sakhal", slug: "sakhal", lastSeenAt: null, avatarHash: HASH, obituarySlug: null,
    life: { id: 1, serverId: 1, playerId: 1, lifeNumber: 4, startedAt: START, endedAt: null, deathCause: null, deathByGamertag: null, deathWeapon: null, deathDistance: null, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null, playtimeSeconds: 0 },
    sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: START, disconnectedAt: null, durationSeconds: null, closeReason: null }],
    kills: [], qualifiedAt: null, encounters: [], verdict: null,
  };
}

function renderPage() {
  return LifePageRoute({ params: Promise.resolve({ slug: "yrjustbad", map: "sakhal", n: "4" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getPlayerLife.mockResolvedValue(lifeData());
});

/**
 * ⚠️ The block dialog promises "Blocking hides their avatar from you", and this 132px hero was
 * the one avatar surface where that promise did not hold. The fix is deliberately at the PAGE
 * layer: `getLifeTimeline` keeps returning the hash viewer-independently, because the same
 * payload is also served through a cookie-free, shared, prerender-feeding fetch.
 */
describe("life page — viewer-scoped avatar blocking", () => {
  test("a blocker sees the initial disc, not the blocked player's face", async () => {
    getBlocks.mockResolvedValue({ blocks: [{ gamertag: "YrJustBad", createdAt: START }] });
    const { container } = render(await renderPage());
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Y")).toBeInTheDocument();
  });

  test("matches the block case-insensitively, so a later rename in casing still hides the face", async () => {
    getBlocks.mockResolvedValue({ blocks: [{ gamertag: "yrjustbad", createdAt: START }] });
    const { container } = render(await renderPage());
    expect(container.querySelector("img")).toBeNull();
  });

  // ⚠️ THE load-bearing case. A block is VIEWER-SCOPED; if this ever fails, one user's block has
  // become a takedown over everybody else's page.
  test("a THIRD PARTY who blocked someone else still sees the face", async () => {
    getBlocks.mockResolvedValue({ blocks: [{ gamertag: "SomeoneElse", createdAt: START }] });
    const { container } = render(await renderPage());
    expect(container.querySelector("img")).toHaveAttribute("src", `/api/avatars/${HASH}.webp`);
  });

  // Signed out: `getBlocks` 401s. Blocking nobody is the right reading, and it must not take the
  // page down.
  test("a signed-out visitor sees the face and the page still renders", async () => {
    getBlocks.mockRejectedValue(new Error("Unauthorized"));
    const { container } = render(await renderPage());
    expect(container.querySelector("img")).toHaveAttribute("src", `/api/avatars/${HASH}.webp`);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Life 4 · Sakhal");
  });
});
