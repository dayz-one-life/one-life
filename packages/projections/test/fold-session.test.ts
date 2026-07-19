import { describe, it, expect } from "vitest";
import { MemoryStore, applyEvent } from "../src/index.js";
import type { ProjectionEvent } from "../src/index.js";

const ev = (over: Partial<ProjectionEvent>): ProjectionEvent => ({
  id: 1, serverId: 1, type: "player.connected", occurredAt: new Date("2026-07-06T12:00:00Z"),
  payload: { gamertag: "A", dayzId: "A=" }, ...over,
});

describe("connect/disconnect fold", () => {
  it("connect creates player, life #1, and an open session", async () => {
    const s = new MemoryStore();
    await applyEvent(s, ev({}));
    const p = await s.getPlayer("A");
    expect(p).not.toBeNull();
    const life = await s.getOpenLife(1, p!.id);
    expect(life).toMatchObject({ lifeNumber: 1 });
    expect(await s.getOpenSession(1, p!.id)).not.toBeNull();
  });

  it("reconnect keeps the same life and supersedes the prior open session", async () => {
    const s = new MemoryStore();
    await applyEvent(s, ev({ id: 1 }));
    const p = await s.getPlayer("A");
    const life1 = await s.getOpenLife(1, p!.id);
    await applyEvent(s, ev({ id: 2, occurredAt: new Date("2026-07-06T13:00:00Z") }));
    const life2 = await s.getOpenLife(1, p!.id);
    expect(life2!.id).toBe(life1!.id);
    expect(s.sessions.filter((x) => x.disconnectedAt !== null && x.closeReason === "superseded").length).toBe(1);
  });

  it("disconnect closes the open session and accrues playtime", async () => {
    const s = new MemoryStore();
    await applyEvent(s, ev({ id: 1, occurredAt: new Date("2026-07-06T12:00:00Z") }));
    await applyEvent(s, ev({ id: 2, type: "player.disconnected", occurredAt: new Date("2026-07-06T12:10:00Z") }));
    const p = await s.getPlayer("A");
    expect(await s.getOpenSession(1, p!.id)).toBeNull();
    const life = s.lives.find((l) => l.playerId === p!.id) as any;
    expect(life.playtimeSeconds).toBe(600);
    expect(s.players.find((x) => x.gamertag === "A")!.lastSeenAt).toEqual(new Date("2026-07-06T12:10:00Z"));
  });

  it("marks a life qualified at the backdated playtime crossing", async () => {
    // Session runs 400s from 12:00:00; the life crosses 300s at 12:05:00.
    const s = new MemoryStore();
    await applyEvent(s, ev({ id: 1, occurredAt: new Date("2026-07-19T12:00:00Z") }));
    await applyEvent(s, ev({ id: 2, type: "player.disconnected", occurredAt: new Date("2026-07-19T12:06:40Z") }));
    expect(s.lives[0]!.qualifiedAt?.toISOString()).toBe("2026-07-19T12:05:00.000Z");
  });

  it("does not mark a life qualified below the playtime threshold", async () => {
    const s = new MemoryStore();
    await applyEvent(s, ev({ id: 1, occurredAt: new Date("2026-07-19T12:00:00Z") }));
    await applyEvent(s, ev({ id: 2, type: "player.disconnected", occurredAt: new Date("2026-07-19T12:04:00Z") }));
    expect(s.lives[0]!.qualifiedAt).toBeNull();
  });

  it("never overwrites an existing qualified_at (write-once)", async () => {
    const s = new MemoryStore();
    await applyEvent(s, ev({ id: 1, occurredAt: new Date("2026-07-19T12:00:00Z") }));
    await applyEvent(s, ev({ id: 2, type: "player.disconnected", occurredAt: new Date("2026-07-19T12:06:40Z") }));
    const first = s.lives[0]!.qualifiedAt!;
    await applyEvent(s, ev({ id: 3, occurredAt: new Date("2026-07-19T13:00:00Z") }));
    await applyEvent(s, ev({ id: 4, type: "player.disconnected", occurredAt: new Date("2026-07-19T13:10:00Z") }));
    expect(s.lives[0]!.qualifiedAt!.getTime()).toBe(first.getTime());
  });
});
