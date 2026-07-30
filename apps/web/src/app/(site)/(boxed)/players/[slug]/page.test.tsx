import { describe, it, expect, vi, beforeEach } from "vitest";

const getPlayerPage = vi.fn();
const ownVerifiedSlug = vi.fn();

vi.mock("@/lib/api", () => ({ getPlayerPage: (...a: unknown[]) => getPlayerPage(...a) }));
vi.mock("@/lib/own-slug", () => ({ ownVerifiedSlug: () => ownVerifiedSlug() }));
// Next's redirect helpers throw a control-flow error carrying the kind in `digest`.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
  permanentRedirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};308;` });
  },
  RedirectType: { replace: "replace", push: "push" },
}));
vi.mock("@/components/player/player-profile", () => ({
  PlayerProfile: () => null,
}));

const { default: PlayerPageRoute } = await import("./page");

const p = (slug: string) => Promise.resolve({ slug });
const q = () => Promise.resolve({});

beforeEach(() => {
  getPlayerPage.mockReset().mockResolvedValue({
    gamertag: "Manicdote",
    totals: { kills: 0, lives: 0, deaths: 0, longestLifeSeconds: 0 },
    standing: [],
    pastLives: [],
    pastLivesTotal: 0,
    pastLivesPage: 1,
    pastLivesPageSize: 10,
    obituaries: [],
    obituariesTotal: 0,
  });
  ownVerifiedSlug.mockReset().mockResolvedValue(null);
});

describe("GET /players/[slug]", () => {
  it("307s the owner to / — temporary, because the decision depends on the session", async () => {
    ownVerifiedSlug.mockResolvedValue("manicdote");
    await expect(PlayerPageRoute({ params: p("manicdote"), searchParams: q() })).rejects.toMatchObject({
      digest: expect.stringContaining(";307;"),
    });
  });

  it("does NOT redirect a stranger's page", async () => {
    ownVerifiedSlug.mockResolvedValue("someone-else");
    const el = await PlayerPageRoute({ params: p("manicdote"), searchParams: q() });
    expect(el).toBeTruthy();
  });

  it("does NOT redirect a signed-out viewer", async () => {
    const el = await PlayerPageRoute({ params: p("manicdote"), searchParams: q() });
    expect(el).toBeTruthy();
  });

  it("keeps the rename redirect permanent (308) — that one is not session-dependent", async () => {
    await expect(PlayerPageRoute({ params: p("old-name"), searchParams: q() })).rejects.toMatchObject({
      digest: expect.stringContaining(";308;"),
    });
  });
});
