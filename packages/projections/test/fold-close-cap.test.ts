import { describe, it, expect } from "vitest";
import { MemoryStore, applyEvent } from "../src/index.js";
import type { ProjectionEvent } from "../src/index.js";

const at = (iso: string) => new Date(iso);
const connect = (id: number, occurredAt: string): ProjectionEvent => ({
  id, serverId: 1, type: "player.connected", occurredAt: at(occurredAt),
  payload: { gamertag: "A", dayzId: "A=" },
});
const ping = (id: number, occurredAt: string): ProjectionEvent => ({
  id, serverId: 1, type: "player.position", occurredAt: at(occurredAt),
  payload: { gamertag: "A", x: 1000, y: 2000 },
});
const reboot = (id: number, occurredAt: string): ProjectionEvent => ({
  id, serverId: 1, type: "server.rebooted", occurredAt: at(occurredAt),
  payload: { localDateTime: "2026-07-06 00:00:00" },
});
const disconnect = (id: number, occurredAt: string): ProjectionEvent => ({
  id, serverId: 1, type: "player.disconnected", occurredAt: at(occurredAt),
  payload: { gamertag: "A" },
});

/** A missed disconnect (crash/ghost) must not count the offline gap as playtime:
 *  superseded and reboot closes are capped at the player's last_seen_at heartbeat. */
describe("superseded/reboot close cap at last_seen_at", () => {
  it("caps a superseded close at the last heartbeat, not the reconnect time", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "2026-07-06T12:00:00Z"));
    await applyEvent(s, ping(2, "2026-07-06T12:10:00Z"));   // last sign of life
    await applyEvent(s, connect(3, "2026-07-06T15:00:00Z")); // crash gap: 2h50m offline
    const superseded = s.sessions.find((x) => x.closeReason === "superseded")!;
    expect(superseded.disconnectedAt).toEqual(at("2026-07-06T12:10:00Z"));
    expect(superseded.durationSeconds).toBe(600);            // 10 min observed, not 3h
    const p = await s.getPlayer("A");
    const life = s.lives.find((l) => l.playerId === p!.id) as any;
    expect(life.playtimeSeconds).toBe(600);
  });

  it("a connect-then-vanish superseded session contributes zero playtime", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "2026-07-06T12:00:00Z")); // no pings after connect
    await applyEvent(s, connect(2, "2026-07-06T13:00:00Z"));
    const superseded = s.sessions.find((x) => x.closeReason === "superseded")!;
    expect(superseded.disconnectedAt).toEqual(at("2026-07-06T12:00:00Z"));
    expect(superseded.durationSeconds).toBe(0);
  });

  it("caps a reboot close at the last heartbeat, not the boot time", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "2026-07-06T12:00:00Z"));
    await applyEvent(s, ping(2, "2026-07-06T12:05:00Z"));
    await applyEvent(s, reboot(3, "2026-07-06T14:00:00Z")); // downtime gap
    const closed = s.sessions.find((x) => x.closeReason === "reboot")!;
    expect(closed.disconnectedAt).toEqual(at("2026-07-06T12:05:00Z"));
    expect(closed.durationSeconds).toBe(300);
  });

  it("a clean disconnect is NOT capped — the server vouches for presence until the line", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "2026-07-06T12:00:00Z"));
    await applyEvent(s, ping(2, "2026-07-06T12:10:00Z"));    // stale heartbeat
    await applyEvent(s, disconnect(3, "2026-07-06T12:30:00Z"));
    const closed = s.sessions.find((x) => x.closeReason === "clean")!;
    expect(closed.disconnectedAt).toEqual(at("2026-07-06T12:30:00Z"));
    expect(closed.durationSeconds).toBe(1800);
  });
});
