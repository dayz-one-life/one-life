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
    const v = await s.getPlayer("Victim");
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
    const flamin = await s.getPlayer("flaminx0r");
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
    const flamin = await s.getPlayer("flaminx0r");
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
    const a = await s.getPlayer("A");
    expect(await s.getOpenLife(1, a!.id)).not.toBeNull();
  });

  // The parser reads a kill line that names the victim's own id as the killer (a player caught by
  // his own explosive) as a non-player death with no killer — adm-parser's death.test.ts pins that
  // exact result. This pins what the fold then does with it: no kill credited, nobody named.
  // (Payloads are written out by hand: this package does not depend on the parser.)
  it("a self-kill line writes no kills row and leaves death_by_gamertag null", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "Victim One", "2026-07-06T12:00:00Z"));
    await applyEvent(s, { id: 2, serverId: 1, type: "player.died", occurredAt: new Date("2026-07-06T12:30:00Z"),
      payload: { victim: "Victim One", dayzId: "1111111111111111111111111111111111111111", cause: "explosion",
        killer: null, weapon: null, distance: null, energy: null, water: null, bleedSources: null, deathEntity: "M79" } });

    expect(s.kills).toEqual([]);
    const victim = await s.getPlayer("Victim One");
    const life = s.lives.find((l) => l.playerId === victim!.id)! as any;
    expect(life.endedAt).not.toBeNull();
    expect(life.deathCause).toBe("explosion");
    expect(life.deathByGamertag).toBeNull();
    // The parser sends no weapon or distance on a self-kill, so the timeline has nothing to print
    // under "Died - Explosion".
    expect(life.deathWeapon ?? null).toBeNull();
    expect(life.deathDistance ?? null).toBeNull();
  });

  // ⚠️ Permanent, not a gap. The kill line names no placer, so the fold credits nobody. A player
  // whose placed trap kills another is credited (operator decision 2026-11-10), but by a later,
  // separate pass that reads the placement record — never by the fold.
  it("the fold names nobody on a trap death and credits no kill (trap credit is a separate pass)", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "Victim One", "2026-07-06T12:00:00Z"));
    await applyEvent(s, { id: 2, serverId: 1, type: "player.died", occurredAt: new Date("2026-07-06T12:30:00Z"),
      payload: { victim: "Victim One", dayzId: "1111111111111111111111111111111111111111", cause: "explosion",
        killer: null, weapon: null, distance: null, energy: null, water: null, bleedSources: null, deathEntity: "LandMineTrap" } });
    const life = s.lives[0]! as any;
    expect(life.deathCause).toBe("explosion");
    expect(life.deathByGamertag).toBeNull();
    expect(s.kills).toEqual([]);
  });

  // Operator decision 2026-11-10: a kill by a player who was already dead when the line was
  // written counts as a player kill. The usual case is a mutual kill: each of the two lines names
  // the other player; each ends one life and credits one kill.
  it("a mutual kill ends both lives as pvp and credits each player with the other", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "Victim One", "2026-07-06T12:00:00Z"));
    await applyEvent(s, connect(2, "Killer Two", "2026-07-06T12:00:00Z"));
    const at = new Date("2026-07-06T12:30:00Z");
    await applyEvent(s, { id: 3, serverId: 1, type: "player.died", occurredAt: at,
      payload: { victim: "Victim One", dayzId: "1111111111111111111111111111111111111111", cause: "pvp", killer: "Killer Two", weapon: "M4-A1", distance: 14.5, deathEntity: null } });
    await applyEvent(s, { id: 4, serverId: 1, type: "player.died", occurredAt: at,
      payload: { victim: "Killer Two", dayzId: "2222222222222222222222222222222222222222", cause: "pvp", killer: "Victim One", weapon: "M4-A1", distance: 14.5, deathEntity: null } });
    expect(s.lives.filter((l) => (l as any).endedAt !== null).length).toBe(2);
    expect(s.lives.every((l) => (l as any).deathCause === "pvp")).toBe(true);
    expect(s.kills.map((k) => [k.killerGamertag, k.victimGamertag])).toEqual([["Killer Two", "Victim One"], ["Victim One", "Killer Two"]]);
  });

  // ⚠️ The fold stores the kill at the VICTIM's timestamp, which DayZ sometimes stamps a second
  // after the killer's own death. The fold does not move it: the readers' kill window ends
  // KILL_WINDOW_GRACE_SECONDS (2 s) after lives.ended_at, so the kill still counts toward the life
  // that just ended (read-models kill-window.ts, the enforcer's pg-store, the notifier).
  it("a kill logged a second after the killer's own death is credited, but falls after his life", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "Victim One", "2026-07-06T12:00:00Z"));
    await applyEvent(s, connect(2, "Killer Two", "2026-07-06T12:00:00Z"));
    const first = new Date("2026-07-06T12:30:00Z");
    const second = new Date("2026-07-06T12:30:01Z");
    await applyEvent(s, { id: 3, serverId: 1, type: "player.died", occurredAt: first,
      payload: { victim: "Killer Two", dayzId: "2222222222222222222222222222222222222222", cause: "pvp", killer: "Victim One", weapon: "M4-A1", distance: 14.5, deathEntity: null } });
    await applyEvent(s, { id: 4, serverId: 1, type: "player.died", occurredAt: second,
      payload: { victim: "Victim One", dayzId: "1111111111111111111111111111111111111111", cause: "pvp", killer: "Killer Two", weapon: "M4-A1", distance: 14.5, deathEntity: null } });

    const posthumous = s.kills.find((k) => k.killerGamertag === "Killer Two")! as any;
    expect(posthumous.victimGamertag).toBe("Victim One");
    expect(posthumous.occurredAt).toEqual(second);

    const killer = await s.getPlayer("Killer Two");
    const killerLives = s.lives.filter((l) => l.playerId === killer!.id) as any[];
    expect(killerLives).toHaveLength(1);                      // crediting the kill opens no new life
    expect(killerLives[0].endedAt).toEqual(first);
    expect(posthumous.occurredAt.getTime()).toBeGreaterThan(killerLives[0].endedAt.getTime());
  });
});
