import { describe, it, expect } from "vitest";
import { MemoryStore, applyEvent } from "../src/index.js";
import type { ProjectionEvent } from "../src/index.js";

describe("hit + position fold", () => {
  it("inserts a hit and links a known victim, idempotent on natural key", async () => {
    const s = new MemoryStore();
    await applyEvent(s, { id: 1, serverId: 1, type: "player.connected", occurredAt: new Date("2026-07-06T12:00:00Z"), payload: { gamertag: "V", dayzId: "V=" } });
    const hit: ProjectionEvent = { id: 2, serverId: 1, type: "player.hit", occurredAt: new Date("2026-07-06T12:01:00Z"),
      payload: { victim: "V", victimHp: 90, attackerType: "infected", attackerGamertag: null, attackerLabel: "Infected", damage: 5, bodyPart: "Head", x: 50, y: 60 } };
    await applyEvent(s, hit);
    await applyEvent(s, { ...hit, id: 3 });   // duplicate re-pull
    expect(s.hits.length).toBe(1);
    expect(s.hits[0]!.victimPlayerId).not.toBeNull();
    expect(s.hits[0]).toMatchObject({ x: 50, y: 60 });
  });

  it("records a position for a known player and no-ops for unknown", async () => {
    const s = new MemoryStore();
    await applyEvent(s, { id: 1, serverId: 1, type: "player.position", occurredAt: new Date("2026-07-06T12:00:00Z"), payload: { gamertag: "Ghost", x: 1, y: 2 } });
    expect(s.positions.length).toBe(0);       // unknown gamertag → no-op
    await applyEvent(s, { id: 2, serverId: 1, type: "player.connected", occurredAt: new Date("2026-07-06T12:00:00Z"), payload: { gamertag: "Real", dayzId: "R=" } });
    await applyEvent(s, { id: 3, serverId: 1, type: "player.position", occurredAt: new Date("2026-07-06T12:02:00Z"), payload: { gamertag: "Real", x: 10, y: 20 } });
    expect(s.positions.length).toBe(1);
    expect(s.positions[0]).toMatchObject({ gamertag: "Real", x: 10, y: 20 });
  });

  it("a position event advances the player's last_seen_at (heartbeat)", async () => {
    const s = new MemoryStore();
    const t0 = new Date("2026-07-11T00:00:00Z");
    const t1 = new Date("2026-07-11T00:05:00Z");
    await applyEvent(s, { id: 1, serverId: 1, type: "player.connected", occurredAt: t0, payload: { gamertag: "Heartbeat", dayzId: "H=" } });
    await applyEvent(s, { id: 2, serverId: 1, type: "player.position", occurredAt: t1, payload: { gamertag: "Heartbeat", x: 1, y: 2 } });
    const p = await s.getPlayer(1, "Heartbeat");
    expect(p).not.toBeNull();
    expect(s.players.find((x) => x.id === p!.id)!.lastSeenAt.getTime()).toBe(t1.getTime());
  });
});
