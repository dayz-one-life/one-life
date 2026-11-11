import { and, eq, inArray, sql } from "drizzle-orm";
import { bans, lives, players, getDb, type Database } from "@onelife/db";
import { sweepCaughtUp, verdictSweepBacklog, type VerdictSweepBacklog } from "@onelife/read-models";
import { lifeQualifies } from "./decide.js";
import { endedLifeOf } from "./pg-store.js";

/**
 * `pnpm --filter @onelife/enforcer run unqualified-bans [-- --lift]` (death-verdict spec 6.4).
 *
 * Lists the running `qualified_death` bans (`pending` or `applied`) whose life no longer qualifies
 * by the predicate `planBans` uses (`lifeQualifies`): what is left behind when an operator denies a
 * trap kill that was the only reason a short life qualified. With `--lift` each one is lifted the
 * way a token lifts it, but marked `lift_reason = 'operator'`: an applied ban goes to
 * `lift_pending` (the enforcer's next tick takes it off the server's ban list, keeping any name
 * another running ban still needs: `namesToRemove`), a pending one, never applied, straight to
 * `lifted`.
 *
 * ⚠️ DRY-RUN BY DEFAULT: without --lift it changes nothing.
 * ⚠️ Refuses while the verdict sweep has anything outstanding: in the gap after a `--rebuild` every
 * trap kill is absent, every life that qualified through one would be listed, and --lift would let
 * those players back in. A token spent on a ban lifted here is refunded by hand.
 */

export interface UnqualifiedBan {
  id: number;
  serverId: number;
  gamertag: string;
  dayzId: string | null;
  lifeStartedAt: Date;
  status: string;
  dryRun: boolean;
  expiresAt: Date | null;
}

/**
 * Running qualified-death bans whose life no longer qualifies. The life is found on the ban's
 * server and start time, through the player's alias history (`bans.gamertag` is the name at ban
 * time) or the ban's dayz id. A ban whose life cannot be found is not listed: nothing can be said
 * about it, and after a rebuild the sweep guard has already refused.
 */
export async function findUnqualifiedBans(db: Database): Promise<UnqualifiedBan[]> {
  const running = await db
    .select({
      id: bans.id, serverId: bans.serverId, gamertag: bans.gamertag, dayzId: bans.dayzId, lifeStartedAt: bans.lifeStartedAt,
      status: bans.status, dryRun: bans.dryRun, expiresAt: bans.expiresAt,
    })
    .from(bans)
    .where(and(eq(bans.reason, "qualified_death"), inArray(bans.status, ["pending", "applied"])))
    .orderBy(bans.id);
  const out: UnqualifiedBan[] = [];
  for (const b of running) {
    const who = b.dayzId
      ? sql`(${players.dayzId} = ${b.dayzId} OR ${players.id} IN (SELECT pg.player_id FROM player_gamertags pg WHERE lower(pg.gamertag) = lower(${b.gamertag})))`
      : sql`${players.id} IN (SELECT pg.player_id FROM player_gamertags pg WHERE lower(pg.gamertag) = lower(${b.gamertag}))`;
    const [l] = await db
      .select({
        serverId: lives.serverId, gamertag: players.gamertag, dayzId: players.dayzId, startedAt: lives.startedAt, endedAt: lives.endedAt,
        deathCause: lives.deathCause, playtimeSeconds: lives.playtimeSeconds,
      })
      .from(lives)
      .innerJoin(players, eq(players.id, lives.playerId))
      .where(and(eq(lives.serverId, b.serverId), eq(lives.startedAt, b.lifeStartedAt), who))
      .limit(1);
    if (!l || !l.endedAt) continue;
    if (lifeQualifies(await endedLifeOf(db, { ...l, endedAt: l.endedAt }))) continue;
    out.push({ ...b, id: Number(b.id) });
  }
  return out;
}

/**
 * Lift the given bans as the operator. Each update re-checks the status it read, so a ban the
 * enforcer applied (or a player redeemed) in between is left to the next run.
 */
export async function liftAsOperator(db: Database, list: UnqualifiedBan[], now: Date): Promise<number> {
  let n = 0;
  for (const b of list) {
    const r = b.status === "applied"
      ? await db.update(bans).set({ status: "lift_pending", liftReason: "operator" })
        .where(and(eq(bans.id, b.id), eq(bans.status, "applied"))).returning({ id: bans.id })
      : await db.update(bans).set({ status: "lifted", liftedAt: now, liftReason: "operator" })
        .where(and(eq(bans.id, b.id), eq(bans.status, "pending"))).returning({ id: bans.id });
    n += r.length;
  }
  return n;
}

export class SweepNotCaughtUpError extends Error {
  constructor(readonly backlog: VerdictSweepBacklog) {
    super(`refusing: the verdict sweep has not caught up (queue ${backlog.queued}, lives without a current verdict `
      + `${backlog.unswept}, fold behind: ${backlog.foldBehind}). In the gap after a rebuild every trap kill is absent. `
      + "Wait for `verify-verdicts -- --held` to show an empty queue, then run this again.");
    this.name = "SweepNotCaughtUpError";
  }
}

export interface UnqualifiedDeps {
  now: Date;
  out: (line: string) => void;
  /** Test seam; defaults to `verdictSweepBacklog`. */
  sweepBacklog?: (db: Database) => Promise<VerdictSweepBacklog>;
}

export async function runUnqualifiedBans(db: Database, args: { lift: boolean }, deps: UnqualifiedDeps): Promise<{ listed: number; lifted: number }> {
  const backlog = await (deps.sweepBacklog ?? verdictSweepBacklog)(db);
  if (!sweepCaughtUp(backlog)) throw new SweepNotCaughtUpError(backlog);
  const list = await findUnqualifiedBans(db);
  deps.out(`${list.length} running ban(s) whose life no longer qualifies${args.lift ? "" : " (dry-run: nothing changes; add --lift)"}`);
  for (const b of list) {
    deps.out(`  ban ${b.id}: server ${b.serverId}, ${b.gamertag}, life started ${b.lifeStartedAt.toISOString()}, ${b.status}`
      + `${b.dryRun ? " (dry-run ban)" : ""}, expires ${b.expiresAt?.toISOString() ?? "never"}`);
  }
  const lifted = args.lift ? await liftAsOperator(db, list, deps.now) : 0;
  if (args.lift) deps.out(`lifted ${lifted} (lift_reason 'operator'); refund by hand any token spent on them`);
  return { listed: list.length, lifted };
}

export function parseUnqualifiedArgs(argv: string[]): { lift: boolean } {
  let lift = false;
  for (const a of argv) {
    if (a === "--") continue;
    if (a === "--lift") lift = true;
    else throw new Error(`unknown argument ${a}. usage: unqualified-bans [--lift]`);
  }
  return { lift };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseUnqualifiedArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { db, sql: conn } = getDb(url);
  runUnqualifiedBans(db, args, { now: new Date(), out: (l) => console.log(l) })
    .then(() => { process.exitCode = 0; })
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => conn.end());
}
