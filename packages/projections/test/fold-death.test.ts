import { describe, it, expect } from "vitest";
import { MemoryStore, applyEvent } from "../src/index.js";
import type { ProjectionEvent } from "../src/index.js";

const connect = (id: number, gamertag: string, at: string): ProjectionEvent => ({
  id, serverId: 1, type: "player.connected", occurredAt: new Date(at), payload: { gamertag, dayzId: `${gamertag}=` },
});

const died = (
  id: number,
  opts: { victim: string; cause: string; energy?: number | null; water?: number | null; bleedSources?: number | null; occurredAt: Date },
): ProjectionEvent => ({
  id, serverId: 1, type: "player.died", occurredAt: opts.occurredAt,
  payload: {
    victim: opts.victim, dayzId: `${opts.victim}=`, cause: opts.cause,
    energy: opts.energy ?? null, water: opts.water ?? null, bleedSources: opts.bleedSources ?? null,
    killer: null, weapon: null, distance: null,
  },
});

describe("death + kills + reboot fold", () => {
  it("pvp death ends the life, closes session, and records a kill", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "Victim", "2026-07-06T12:00:00Z"));
    await applyEvent(s, connect(2, "Killer", "2026-07-06T12:00:00Z"));
    await applyEvent(s, { id: 3, serverId: 1, type: "player.died", occurredAt: new Date("2026-07-06T12:30:00Z"),
      payload: { victim: "Victim", dayzId: "Victim=", cause: "pvp", killer: "Killer", weapon: "M4A1", distance: 153.4 } });
    const v = await s.getPlayer(1, "Victim");
    expect(await s.getOpenLife(1, v!.id)).toBeNull();
    expect(s.kills.length).toBe(1);
    expect(s.kills[0]).toMatchObject({ killerGamertag: "Killer", victimGamertag: "Victim", weapon: "M4A1", distance: 153.4 });
    expect(s.kills[0]!.killerPlayerId).not.toBeNull();
  });

  it("non-pvp death records no kill", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "A", "2026-07-06T12:00:00Z"));
    await applyEvent(s, { id: 2, serverId: 1, type: "player.died", occurredAt: new Date("2026-07-06T12:05:00Z"),
      payload: { victim: "A", dayzId: "A=", cause: "suicide", killer: null, weapon: null, distance: null } });
    expect(s.kills.length).toBe(0);
  });

  it("duplicate death line on a closed life is ignored", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "A", "2026-07-06T12:00:00Z"));
    const died: ProjectionEvent = { id: 2, serverId: 1, type: "player.died", occurredAt: new Date("2026-07-06T12:05:00Z"),
      payload: { victim: "A", dayzId: "A=", cause: "environment", killer: null, weapon: null, distance: null } };
    await applyEvent(s, died);
    await applyEvent(s, { ...died, id: 3 });
    expect(s.lives.filter((l) => (l as any).endedAt !== null).length).toBe(1);
  });

  it("stores death stats and upgrades died->suicide across the two-line cluster", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "flaminx0r", "2026-07-06T12:00:00Z"));
    const flamin = await s.getPlayer(1, "flaminx0r");
    const flaminPlayerId = flamin!.id;

    const at = new Date("2026-07-12T01:05:41Z");
    await applyEvent(s, died(2, { victim: "flaminx0r", cause: "died", energy: 0, water: 620.083, bleedSources: 1, occurredAt: at }));
    await applyEvent(s, died(3, { victim: "flaminx0r", cause: "suicide", occurredAt: at }));

    const life = s.lives.find((l) => l.playerId === flaminPlayerId)! as any;
    expect(life.deathCause).toBe("suicide");     // upgraded from the second line
    expect(life.energyAtDeath).toBe(0);          // stats from the first line, not clobbered
    expect(life.waterAtDeath).toBeCloseTo(620.083);
    expect(life.bleedSourcesAtDeath).toBe(1);
  });

  it("a bare second death line never re-closes or downgrades a specific cause", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "flaminx0r", "2026-07-06T12:00:00Z"));
    const flamin = await s.getPlayer(1, "flaminx0r");
    const flaminPlayerId = flamin!.id;

    const at = new Date("2026-07-12T01:05:41Z");
    await applyEvent(s, died(2, { victim: "flaminx0r", cause: "suicide", occurredAt: at }));
    await applyEvent(s, died(3, { victim: "flaminx0r", cause: "died", energy: 0, occurredAt: at }));

    const life = s.lives.find((l) => l.playerId === flaminPlayerId)! as any;
    expect(life.deathCause).toBe("suicide");     // not downgraded to "died"
    expect(life.energyAtDeath).toBe(0);          // stats still filled from the later line (was null)
  });

  it("reboot closes all open sessions but leaves lives open", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "A", "2026-07-06T12:00:00Z"));
    await applyEvent(s, connect(2, "B", "2026-07-06T12:00:00Z"));
    await applyEvent(s, { id: 3, serverId: 1, type: "server.rebooted", occurredAt: new Date("2026-07-06T12:20:00Z"),
      payload: { localDateTime: "2026-07-06 12:20:00" } });
    expect(s.sessions.every((x) => x.disconnectedAt !== null)).toBe(true);
    expect(s.sessions.every((x) => (x as any).closeReason === "reboot")).toBe(true);
    const a = await s.getPlayer(1, "A");
    expect(await s.getOpenLife(1, a!.id)).not.toBeNull();
  });
});
