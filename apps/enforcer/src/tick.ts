import type { Database } from "@onelife/db";
import { planBans, planExpiries, banNames, namesToRelease } from "./decide.js";
import {
  findEndedUnbannedLives, insertBan, pendingBans, appliedBans, liftPendingBans,
  markApplied, markError, markExpired, markLifted, serverServiceId,
} from "./pg-store.js";

/** Minimal Nitrado surface the enforcer needs — real client or a fake in tests. */
export interface BanClient {
  addBans(names: string[]): Promise<void>;
  removeBans(names: string[]): Promise<void>;
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
  const plans = planBans(await findEndedUnbannedLives(db), deps.banDurationHours, deps.now);
  for (const p of plans) await insertBan(db, p, deps.dryRun);

  // ── apply ──
  let applied = 0;
  let expired = 0;
  for (const b of await pendingBans(db)) {
    if (deps.dryRun) {
      deps.log.info({ gamertag: b.gamertag, serverId: b.serverId }, "DRY RUN: would ban");
      continue;
    }
    // A ban still pending when its time is up (Nitrado kept failing, or old rows met a switch
    // from dry-run to enforcing) is never sent: adding the player only to remove them below would
    // also take them off the list for any other ban they are serving.
    if (planExpiries([b], deps.now).length > 0) {
      await markExpired(db, b.id, deps.now);
      expired++;
      continue;
    }
    try {
      const sid = await serverServiceId(db, b.serverId);
      await deps.nitradoFor(sid).addBans(banNames(b));
      await markApplied(db, b.id, deps.now);
      applied++;
    } catch (e) {
      await markError(db, b.id, e instanceof Error ? e.message : String(e));
      deps.log.error?.({ err: e, gamertag: b.gamertag }, "ban apply failed (will retry)");
    }
  }

  // ── expire ──
  const active = await appliedBans(db);
  const dueIds = new Set(planExpiries(active.map((b) => ({ id: b.id, expiresAt: b.expiresAt })), deps.now));
  // Bans that stay in force after this pass. A name one of them holds must stay on the Nitrado
  // list when another ban of the same player expires (decide.ts namesToRelease).
  const stillRunning = active.filter((b) => !dueIds.has(b.id));
  for (const b of active.filter((b) => dueIds.has(b.id))) {
    if (deps.dryRun) {
      await markExpired(db, b.id, deps.now);
      expired++;
      continue;
    }
    try {
      const names = namesToRelease(b, stillRunning);
      if (names.length > 0) {
        const sid = await serverServiceId(db, b.serverId);
        await deps.nitradoFor(sid).removeBans(names);
      } else {
        deps.log.info({ gamertag: b.gamertag, serverId: b.serverId }, "ban expired; a later ban still holds the player");
      }
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
      await deps.nitradoFor(sid).removeBans(banNames(b));
      await markLifted(db, b.id, deps.now);
      lifted++;
    } catch (e) {
      await markError(db, b.id, e instanceof Error ? e.message : String(e));
      deps.log.error?.({ err: e, gamertag: b.gamertag }, "ban lift failed (will retry)");
    }
  }

  return { detected: plans.length, applied, expired, lifted, dryRun: deps.dryRun };
}
