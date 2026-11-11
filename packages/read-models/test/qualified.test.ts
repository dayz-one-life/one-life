import { describe, it, expect } from "vitest";
import { livePlaytime, QUALIFY_SECONDS, isLifeQualified } from "../src/qualified.js";

const t = (iso: string) => new Date(iso);

describe("livePlaytime caps at the heartbeat", () => {
  it("counts an open session only up to last_seen_at, not now", () => {
    const connectedAt = t("2026-07-11T00:00:00Z");
    const lastSeen = t("2026-07-11T00:03:00Z"); // 3 min heartbeat
    expect(livePlaytime(0, { connectedAt }, lastSeen)).toBe(180);
    expect(livePlaytime(120, { connectedAt }, lastSeen)).toBe(300); // stored + open
    expect(livePlaytime(120, null, lastSeen)).toBe(120);            // no open session
    expect(livePlaytime(120, { connectedAt }, null)).toBe(120);     // no heartbeat
  });
});

describe("isLifeQualified", () => {
  const base = { deathCause: null as string | null, effectivePlaytimeSeconds: 0, startedAt: t("2026-07-11T00:00:00Z"), windowEnd: t("2026-07-11T00:02:00Z"), playerKills: [] as { occurredAt: Date }[] };

  it("qualifies a PvP death", () => {
    expect(isLifeQualified({ ...base, deathCause: "pvp" })).toBe(true);
  });
  it("qualifies a life where the player scored a kill in-window", () => {
    expect(isLifeQualified({ ...base, playerKills: [{ occurredAt: t("2026-07-11T00:01:00Z") }] })).toBe(true);
  });
  it("ignores a kill outside the life window", () => {
    expect(isLifeQualified({ ...base, playerKills: [{ occurredAt: t("2026-07-11T05:00:00Z") }] })).toBe(false);
  });
  it("qualifies at >= 5 minutes and not below", () => {
    expect(isLifeQualified({ ...base, effectivePlaytimeSeconds: QUALIFY_SECONDS })).toBe(true);
    expect(isLifeQualified({ ...base, effectivePlaytimeSeconds: QUALIFY_SECONDS - 1 })).toBe(false);
  });
  it("leaves a short, kill-less, non-PvP life provisional/discarded (not qualified)", () => {
    expect(isLifeQualified({ ...base, effectivePlaytimeSeconds: 120 })).toBe(false);
  });
});

// A kill line can be stamped a second after its killer's own death line. It counts toward the
// life that just ended (kill-window.ts), so that life qualifies "by kill" whatever its playtime.
describe("isLifeQualified — a kill logged just after the killer's own death", () => {
  const died = t("2026-07-11T00:02:00Z");
  const short = { deathCause: "explosion" as string | null, effectivePlaytimeSeconds: 120, startedAt: t("2026-07-11T00:00:00Z"), windowEnd: died, playerKills: [] as { occurredAt: Date }[] };

  it("qualifies a life under five minutes by a kill one or two seconds after its end", () => {
    expect(isLifeQualified({ ...short })).toBe(false);
    expect(isLifeQualified({ ...short, playerKills: [{ occurredAt: t("2026-07-11T00:02:01Z") }] })).toBe(true);
    expect(isLifeQualified({ ...short, playerKills: [{ occurredAt: t("2026-07-11T00:02:02Z") }] })).toBe(true);
  });
  it("does not by a kill three seconds after its end", () => {
    expect(isLifeQualified({ ...short, playerKills: [{ occurredAt: t("2026-07-11T00:02:03Z") }] })).toBe(false);
  });
  it("does not let the previous life's posthumous kill qualify the next life", () => {
    const next = { deathCause: null, effectivePlaytimeSeconds: 0, startedAt: t("2026-07-11T00:02:01Z"), windowEnd: t("2026-07-11T00:04:00Z"), previousLifeEndedAt: died };
    expect(isLifeQualified({ ...next, playerKills: [{ occurredAt: t("2026-07-11T00:02:01Z") }] })).toBe(false);
    expect(isLifeQualified({ ...next, playerKills: [{ occurredAt: t("2026-07-11T00:02:02Z") }] })).toBe(false);
    expect(isLifeQualified({ ...next, playerKills: [{ occurredAt: t("2026-07-11T00:02:03Z") }] })).toBe(true);
  });
});
