import { describe, it, expect } from "vitest";
import { MemoryStore, applyEvent } from "../src/index.js";
import type { ProjectionEvent } from "../src/index.js";

const at = (s: string) => new Date(s);

describe("fold player.unconscious", () => {
  // ⚠️ fold.ts's switch ends in `default: return`, so a MISSING case is silently ignored
  // rather than throwing. This test is the only thing that catches that.
  it("records an unconscious event for a known player", async () => {
    const s = new MemoryStore();
    await applyEvent(s, { id: 1, serverId: 3, type: "player.connected",
      occurredAt: at("2026-07-17T16:00:00Z"), payload: { gamertag: "XxBE4zyxX", dayzId: "D34=" } });
    const ev: ProjectionEvent = { id: 2, serverId: 3, type: "player.unconscious",
      occurredAt: at("2026-07-17T16:25:31Z"),
      payload: { gamertag: "XxBE4zyxX", disconnecting: true, x: 1, y: 2 } };
    await applyEvent(s, ev);
    expect(s.unconscious.length).toBe(1);
    expect(s.unconscious[0]).toMatchObject({
      serverId: 3, gamertag: "XxBE4zyxX", disconnecting: true,
      occurredAt: at("2026-07-17T16:25:31Z"),
    });
  });

  // The `positions` pattern: playerId is notNull + FK, so an unresolvable player must be
  // skipped, never inserted as null. Inserting would violate the FK inside the fold
  // transaction, and an event-log fold retries a failure forever — a crash loop.
  it("no-ops for an unknown gamertag", async () => {
    const s = new MemoryStore();
    await applyEvent(s, { id: 1, serverId: 3, type: "player.unconscious",
      occurredAt: at("2026-07-17T16:25:31Z"),
      payload: { gamertag: "NeverSeen", disconnecting: false, x: null, y: null } });
    expect(s.unconscious.length).toBe(0);
  });
});
