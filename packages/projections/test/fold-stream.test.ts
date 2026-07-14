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
    const p = await s.getPlayer(1, "A");
    const life = s.lives.find((l) => l.playerId === p!.id) as any;
    expect(life.lifeNumber).toBe(1);
    expect(life.playtimeSeconds).toBe(1800 + 900); // 30 min + 15 min
    expect(life.endedAt).not.toBeNull();
  });

  it("throws PayloadError on a malformed connected payload", async () => {
    const s = new MemoryStore();
    await expect(applyEvent(s, { id: 1, serverId: 1, type: "player.connected", occurredAt: new Date(), payload: {} } as ProjectionEvent))
      .rejects.toBeInstanceOf(PayloadError);
  });
});
