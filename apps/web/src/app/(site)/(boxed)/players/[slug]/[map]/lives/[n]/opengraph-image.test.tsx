import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";

vi.mock("@/lib/api", () => ({ getPlayerLife: vi.fn() }));
import { getPlayerLife } from "@/lib/api";
// Wrap (not replace) the real CardShell so the PNG still renders and the props it was given
// can be read back: the status cell and the middle slot are otherwise only pixels.
vi.mock("@/lib/og/card-shell", async (orig) => {
  const m = await orig<typeof import("@/lib/og/card-shell")>();
  return { ...m, CardShell: vi.fn(m.CardShell) };
});
import { CardShell } from "@/lib/og/card-shell";

const deadLife = {
  life: {
    lifeNumber: 3,
    endedAt: "2026-07-01T00:00:00.000Z",
    deathCause: "gunshot",
    playtimeSeconds: 5400,
    startedAt: "2026-06-30T00:00:00.000Z",
  },
  sessions: [{}, {}],
  kills: [{}],
  gamertag: "TaggedSurvivor",
  map: "livonia",
} as never;

const liveLife = {
  life: {
    lifeNumber: 3,
    endedAt: null,
    deathCause: null,
    playtimeSeconds: 5400,
    startedAt: "2026-06-30T00:00:00.000Z",
  },
  sessions: [{}, {}],
  kills: [{}],
  gamertag: "TaggedSurvivor",
  map: "livonia",
} as never;

// An open life closed by a server retirement. `deathCause` is set on purpose: a retired life
// has none in practice, but a non-null one pins that the cause line is suppressed by the
// retirement itself rather than by the data happening to be empty.
const retiredLife = {
  life: {
    lifeNumber: 3,
    endedAt: "2026-10-15T09:00:00.000Z",
    endReason: "server_retired",
    deathCause: "gunshot",
    playtimeSeconds: 5400,
    startedAt: "2026-10-01T00:00:00.000Z",
  },
  sessions: [{}, {}],
  kills: [],
  gamertag: "TaggedSurvivor",
  map: "enoch",
} as never;

describe("life opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders a PNG for a dead life", async () => {
    vi.mocked(getPlayerLife).mockResolvedValue(deadLife);
    const res = await OgImage({ params: Promise.resolve({ slug: "taggedsurvivor", map: "livonia", n: "3" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders a PNG for a live life", async () => {
    vi.mocked(getPlayerLife).mockResolvedValue(liveLife);
    const res = await OgImage({ params: Promise.resolve({ slug: "taggedsurvivor", map: "livonia", n: "3" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders a retired life as RETIRED: status not hot, and no cause line", async () => {
    const lastShell = () => vi.mocked(CardShell).mock.calls.at(-1)![0];

    // Control: the same probe DOES find the cause line and a hot DEAD on a dead life.
    vi.mocked(getPlayerLife).mockResolvedValue(deadLife);
    await (await OgImage({ params: Promise.resolve({ slug: "taggedsurvivor", map: "livonia", n: "3" }) })).arrayBuffer();
    expect(lastShell().stats!.find((s) => s.label === "status")).toEqual({ label: "status", value: "DEAD", hot: true });
    expect(JSON.stringify(lastShell().children)).toContain("Gunshot");

    vi.mocked(getPlayerLife).mockResolvedValue(retiredLife);
    const res = await OgImage({ params: Promise.resolve({ slug: "taggedsurvivor", map: "chernarus-1.29", n: "3" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(lastShell().stats!.find((s) => s.label === "status")).toEqual({ label: "status", value: "RETIRED", hot: false });
    expect(JSON.stringify(lastShell().children)).not.toContain("Gunshot");
  });

  it("renders the generic fallback PNG when the api is down", async () => {
    vi.mocked(getPlayerLife).mockRejectedValue(new Error("api down"));
    const res = await OgImage({ params: Promise.resolve({ slug: "taggedsurvivor", map: "livonia", n: "3" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
  });

  it("prints the public death's label", async () => {
    const lastShell = () => vi.mocked(CardShell).mock.calls.at(-1)![0];
    vi.mocked(getPlayerLife).mockResolvedValue({ ...(deadLife as object), verdict: { status: "final", label: "Likely starvation and thirst" } } as never);
    await (await OgImage({ params: Promise.resolve({ slug: "taggedsurvivor", map: "livonia", n: "3" }) })).arrayBuffer();
    expect(JSON.stringify(lastShell().children)).toContain("Likely starvation and thirst");
  });

  // ⚠️ Next's own default for an opengraph-image is `public, immutable, max-age=31536000`. The card
  // prints the live label, which an override, a classifier fix or a switched-off inferred family
  // can still change, so no response may keep that default (spec 6.2 item 5).
  const cacheOf = async (payload: unknown) => {
    if (payload instanceof Error) vi.mocked(getPlayerLife).mockRejectedValue(payload);
    else vi.mocked(getPlayerLife).mockResolvedValue(payload as never);
    return (await OgImage({ params: Promise.resolve({ slug: "taggedsurvivor", map: "livonia", n: "3" }) })).headers.get("cache-control");
  };
  it("a final death is cached for a day, never a year", async () => {
    expect(await cacheOf({ ...(deadLife as object), verdict: { status: "final", label: "Fell" } })).toBe("public, max-age=86400");
    expect(await cacheOf({ ...(deadLife as object), verdict: { status: "final", label: "Likely exposure" } })).toBe("public, max-age=86400");
  });
  it("a pending death, an old payload with no verdict and the failure path are cached for a minute", async () => {
    const minute = "public, max-age=60, must-revalidate";
    expect(await cacheOf({ ...(deadLife as object), verdict: { status: "pending", label: "Awaiting the record" } })).toBe(minute);
    expect(await cacheOf(deadLife)).toBe(minute);
    expect(await cacheOf(liveLife)).toBe(minute);
    expect(await cacheOf(new Error("api down"))).toBe(minute);
  });
});
