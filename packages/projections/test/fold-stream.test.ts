import { describe, it, expect } from "vitest";
import { MemoryStore, applyEvent, PayloadError } from "../src/index.js";
import type { ProjectionEvent } from "../src/index.js";

describe("stream fold + validation", () => {
  it("folds a full life story end to end", async () => {
    const s = new MemoryStore();
    const stream: ProjectionEvent[] = [
      { id: 1, serverId: 1, type: "player.connected", occurredAt: new Date("2026-07-06T12:00:00Z"), payload: { gamertag: "A", dayzId: "A=" } },
      { id: 2, serverId: 1, type: "player.disconnected", occurredAt: new Date("2026-07-06T12:30:00Z"), payload: { gamertag: "A", dayzId: "A=" } },
      { id: 3, serverId: 1, type: "player.connected", occurredAt: new Date("2026-07-06T13:00:00Z"), payload: { gamertag: "A", dayzId: "A=" } },
      { id: 4, serverId: 1, type: "player.died", occurredAt: new Date("2026-07-06T13:15:00Z"), payload: { victim: "A", dayzId: "A=", cause: "environment", killer: null, weapon: null, distance: null } },
    ];
    for (const e of stream) await applyEvent(s, e);
    const p = await s.getPlayer("A");
    const life = s.lives.find((l) => l.playerId === p!.id) as any;
    expect(life.lifeNumber).toBe(1);
    expect(life.playtimeSeconds).toBe(1800 + 900); // 30 min + 15 min
    expect(life.endedAt).not.toBeNull();
  });

  it("gives a gamertag one global player with a per-server life", async () => {
    const s = new MemoryStore();
    await applyEvent(s, { serverId: 1, type: "player.connected", occurredAt: new Date("2026-07-01T00:00:00Z"), payload: { gamertag: "Bob" } } as any);
    await applyEvent(s, { serverId: 2, type: "player.connected", occurredAt: new Date("2026-07-01T01:00:00Z"), payload: { gamertag: "Bob" } } as any);
    const p1 = await s.getPlayer("Bob");
    expect(s.players.filter((p) => p.gamertag === "Bob")).toHaveLength(1); // one global player
    const lives = (s.lives as any[]).filter((l) => l.playerId === p1!.id);
    expect(lives.map((l) => l.serverId).sort()).toEqual([1, 2]);          // a life on each server
    expect(lives.every((l) => l.lifeNumber === 1)).toBe(true);            // life_number per server
  });

  it("throws PayloadError on a malformed connected payload", async () => {
    const s = new MemoryStore();
    await expect(applyEvent(s, { id: 1, serverId: 1, type: "player.connected", occurredAt: new Date(), payload: {} } as ProjectionEvent))
      .rejects.toBeInstanceOf(PayloadError);
  });
});
