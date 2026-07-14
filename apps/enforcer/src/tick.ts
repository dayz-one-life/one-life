import type { Database } from "@onelife/db";
import { planBans, planExpiries } from "./decide.js";
import {
  findEndedUnbannedLives, insertBan, pendingBans, appliedBans, liftPendingBans,
  markApplied, markError, markExpired, markLifted, serverServiceId,
} from "./pg-store.js";

/** Minimal Nitrado surface the enforcer needs — real client or a fake in tests. */
export interface BanClient {
  addBan(gamertag: string): Promise<void>;
  removeBan(gamertag: string): Promise<void>;
}

export type EnforcerDeps = {
  nitradoFor: (serviceId: number) => BanClient;
  dryRun: boolean;
  banDurationHours: number;
  now: Date;
  log: { info: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };
};

export type TickResult = { detected: number; applied: number; expired: number; lifted: number; dryRun: boolean };

/**
 * One enforcement cycle: detect qualified deaths → record bans; apply pending bans to Nitrado
 * (unless dry-run); expire due bans. Every Nitrado call is behind the dryRun gate.
 */
export async function enforcerTick(db: Database, deps: EnforcerDeps): Promise<TickResult> {
  // ── detect ──
  const plans = planBans(await findEndedUnbannedLives(db), deps.banDurationHours);
  for (const p of plans) await insertBan(db, p, deps.dryRun);

  // ── apply ──
  let applied = 0;
  for (const b of await pendingBans(db)) {
    if (deps.dryRun) {
      deps.log.info({ gamertag: b.gamertag, serverId: b.serverId }, "DRY RUN: would ban");
      continue;
    }
    try {
      const sid = await serverServiceId(db, b.serverId);
      await deps.nitradoFor(sid).addBan(b.gamertag);
      await markApplied(db, b.id, deps.now);
      applied++;
    } catch (e) {
      await markError(db, b.id, e instanceof Error ? e.message : String(e));
      deps.log.error?.({ err: e, gamertag: b.gamertag }, "ban apply failed (will retry)");
    }
  }

  // ── expire ──
  let expired = 0;
  const active = await appliedBans(db);
  const dueIds = new Set(planExpiries(active.map((b) => ({ id: b.id, expiresAt: b.expiresAt })), deps.now));
  for (const b of active.filter((b) => dueIds.has(b.id))) {
    if (deps.dryRun) {
      await markExpired(db, b.id, deps.now);
      expired++;
      continue;
    }
    try {
      const sid = await serverServiceId(db, b.serverId);
      await deps.nitradoFor(sid).removeBan(b.gamertag);
      await markExpired(db, b.id, deps.now);
      expired++;
    } catch (e) {
      await markError(db, b.id, e instanceof Error ? e.message : String(e));
      deps.log.error?.({ err: e, gamertag: b.gamertag }, "ban expiry failed (will retry)");
    }
  }

  // ── lift (token redemptions) ──
  let lifted = 0;
  for (const b of await liftPendingBans(db)) {
    if (deps.dryRun) {
      await markLifted(db, b.id, deps.now);
      lifted++;
      continue;
    }
    try {
      const sid = await serverServiceId(db, b.serverId);
      await deps.nitradoFor(sid).removeBan(b.gamertag);
      await markLifted(db, b.id, deps.now);
      lifted++;
    } catch (e) {
      await markError(db, b.id, e instanceof Error ? e.message : String(e));
      deps.log.error?.({ err: e, gamertag: b.gamertag }, "ban lift failed (will retry)");
    }
  }

  return { detected: plans.length, applied, expired, lifted, dryRun: deps.dryRun };
}
