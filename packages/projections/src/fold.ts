import type { ProjectionStore } from "./store.js";
import type { ProjectionEvent, SessionRow } from "./types.js";
import { validatePayload } from "./payloads.js";
import { QUALIFY_SECONDS } from "@onelife/domain";

const BUILD_TYPES = new Set([
  "build.placed", "build.built", "build.dismantled", "build.packed", "build.repaired",
]);

export function durationSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

/** Close an open session. For closes the server did NOT vouch for (`capAt` given —
 *  superseded/reboot, i.e. a missed disconnect), the close instant is capped at the player's
 *  last_seen_at heartbeat so the offline gap never counts as playtime ("crash freezes, never
 *  inflates"). A clean close (real disconnect/death line) passes no cap. */
async function closeOpen(store: ProjectionStore, session: SessionRow, at: Date, reason: string, capAt?: Date | null): Promise<void> {
  let end = at;
  if (capAt !== undefined) {
    const cap = Math.max(capAt?.getTime() ?? session.connectedAt.getTime(), session.connectedAt.getTime());
    end = new Date(Math.min(at.getTime(), cap));
  }
  const d = durationSeconds(session.connectedAt, end);
  await store.closeSession(session.id, end, d, reason);
  const total = await store.addLifePlaytime(session.lifeId, d);
  const prior = total - d;
  // Playtime is only credited at session close, so qualified_at is BACKDATED to the
  // instant the life actually crossed the threshold mid-session.
  if (prior < QUALIFY_SECONDS && total >= QUALIFY_SECONDS) {
    const crossing = new Date(session.connectedAt.getTime() + (QUALIFY_SECONDS - prior) * 1000);
    await store.markLifeQualified(session.lifeId, crossing);
  }
}

async function onConnected(store: ProjectionStore, e: ProjectionEvent): Promise<void> {
  const gamertag = String(e.payload.gamertag);
  const dayzId = e.payload.dayzId != null ? String(e.payload.dayzId) : null;
  let player = await store.getPlayer(gamertag);
  // capture BEFORE touchPlayer: the superseded cap must be the heartbeat as of the crash,
  // not this reconnect (and MemoryStore returns its row by reference, so touch would alias it)
  const lastSeenBefore = player?.lastSeenAt ?? null;
  if (!player) player = await store.createPlayer(gamertag, dayzId, e.occurredAt);
  else await store.touchPlayer(player.id, e.occurredAt);

  const open = await store.getOpenSession(e.serverId, player.id);
  if (open) await closeOpen(store, open, e.occurredAt, "superseded", lastSeenBefore);

  let life = await store.getOpenLife(e.serverId, player.id);
  if (!life) {
    const n = (await store.getMaxLifeNumber(e.serverId, player.id)) + 1;
    life = await store.createLife(e.serverId, player.id, n, e.occurredAt);
  }
  await store.createSession(e.serverId, player.id, life.id, e.occurredAt);
}

async function onDisconnected(store: ProjectionStore, e: ProjectionEvent): Promise<void> {
  const player = await store.getPlayer(String(e.payload.gamertag));
  if (!player) return;
  await store.touchPlayer(player.id, e.occurredAt);
  const open = await store.getOpenSession(e.serverId, player.id);
  if (open) await closeOpen(store, open, e.occurredAt, "clean");
}

async function onDied(store: ProjectionStore, e: ProjectionEvent): Promise<void> {
  const victim = String(e.payload.victim);
  const player = await store.getPlayer(victim);
  if (!player) return;                              // never fabricate players from a death line

  const cause = String(e.payload.cause);
  const energy = e.payload.energy != null ? Number(e.payload.energy) : null;
  const water = e.payload.water != null ? Number(e.payload.water) : null;
  const bleedSources = e.payload.bleedSources != null ? Number(e.payload.bleedSources) : null;

  const life = await store.getOpenLife(e.serverId, player.id);
  if (!life) {
    // Second cluster line for an already-closed life: enrich mechanism + backfill stats (idempotent).
    const recentId = await store.getRecentlyEndedLifeId(e.serverId, player.id, e.occurredAt);
    if (recentId != null) await store.enrichLifeDeath(recentId, { cause, energy, water, bleedSources });
    return;
  }

  const open = await store.getOpenSession(e.serverId, player.id);
  if (open) await closeOpen(store, open, e.occurredAt, "clean");

  const killer = e.payload.killer != null ? String(e.payload.killer) : null;
  const weapon = e.payload.weapon != null ? String(e.payload.weapon) : null;
  const distance = e.payload.distance != null ? Number(e.payload.distance) : null;

  await store.endLife(life.id, { endedAt: e.occurredAt, cause, byGamertag: killer, weapon, distance, energy, water, bleedSources });
  if (cause === "pvp") await store.markLifeQualified(life.id, e.occurredAt);

  if (cause === "pvp" && killer && killer !== victim) {
    const killerPlayer = await store.getPlayer(killer);
    await store.insertKill({
      serverId: e.serverId, killerGamertag: killer, killerPlayerId: killerPlayer?.id ?? null,
      victimGamertag: victim, victimPlayerId: player.id, victimLifeId: life.id,
      weapon, distance, occurredAt: e.occurredAt,
    });
    // A kill qualifies the KILLER's life too — insertKill only records the victim's.
    if (killerPlayer) {
      const killerLifeId = await store.findLifeIdAt(e.serverId, killerPlayer.id, e.occurredAt);
      if (killerLifeId != null) await store.markLifeQualified(killerLifeId, e.occurredAt);
    }
  }
}

async function onRebooted(store: ProjectionStore, e: ProjectionEvent): Promise<void> {
  const open = await store.getAllOpenSessions(e.serverId);
  for (const session of open) {
    const p = await store.getPlayerById(session.playerId);
    await closeOpen(store, session, e.occurredAt, "reboot", p?.lastSeenAt ?? null);
  }
}

async function onHit(store: ProjectionStore, e: ProjectionEvent): Promise<void> {
  const victim = String(e.payload.victim);
  const victimPlayer = await store.getPlayer(victim);   // never create from a hit
  await store.insertHit({
    serverId: e.serverId, victimGamertag: victim, victimPlayerId: victimPlayer?.id ?? null,
    attackerGamertag: e.payload.attackerGamertag != null ? String(e.payload.attackerGamertag) : null,
    attackerType: String(e.payload.attackerType),
    attackerLabel: e.payload.attackerLabel != null ? String(e.payload.attackerLabel) : null,
    bodyPart: e.payload.bodyPart != null ? String(e.payload.bodyPart) : null,
    victimHp: e.payload.victimHp != null ? Number(e.payload.victimHp) : null,
    x: e.payload.x != null ? Number(e.payload.x) : null,
    y: e.payload.y != null ? Number(e.payload.y) : null,
    occurredAt: e.occurredAt,
  });
}

async function onPosition(store: ProjectionStore, e: ProjectionEvent): Promise<void> {
  const player = await store.getPlayer(String(e.payload.gamertag));
  if (!player) return;                                              // no-op for unknown gamertag
  await store.touchPlayer(player.id, e.occurredAt);                 // position dump = presence heartbeat
  await store.insertPosition({
    serverId: e.serverId, playerId: player.id, gamertag: player.gamertag,
    x: Number(e.payload.x), y: Number(e.payload.y), recordedAt: e.occurredAt,
  });
}

async function onBuild(store: ProjectionStore, e: ProjectionEvent): Promise<void> {
  const gamertag = String(e.payload.gamertag);
  const player = await store.getPlayer(gamertag);       // never create from a build
  const lifeId = player ? await store.findLifeIdAt(e.serverId, player.id, e.occurredAt) : null;
  await store.insertBuild({
    serverId: e.serverId, gamertag, playerId: player?.id ?? null, lifeId,
    action: String(e.payload.action), object: String(e.payload.object),
    className: e.payload.className != null ? String(e.payload.className) : null,
    tool: e.payload.tool != null ? String(e.payload.tool) : null,
    x: e.payload.x != null ? Number(e.payload.x) : null,
    y: e.payload.y != null ? Number(e.payload.y) : null,
    occurredAt: e.occurredAt,
  });
}

export async function applyEvent(store: ProjectionStore, e: ProjectionEvent): Promise<void> {
  e = { ...e, payload: validatePayload(e.type, e.payload) };
  switch (e.type) {
    case "player.connected": return onConnected(store, e);
    case "player.disconnected": return onDisconnected(store, e);
    case "player.died": return onDied(store, e);
    case "server.rebooted": return onRebooted(store, e);
    case "player.hit": return onHit(store, e);
    case "player.position": return onPosition(store, e);
    case "player.connecting": return; // no projection effect
    default:
      if (BUILD_TYPES.has(e.type)) return onBuild(store, e);
      return;
  }
}
