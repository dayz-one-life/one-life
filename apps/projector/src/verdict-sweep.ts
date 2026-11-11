import { sql } from "drizzle-orm";
import { deathVerdicts, kills, type Database } from "@onelife/db";
import {
  CLASSIFIER_VERSION, INTERNAL_CAUSES, TRAP_DEVICE_OF_CAUSE, classifyDeath, isObjectKey,
  type Confidence, type CreditEvidence, type InternalVerdict, type ObjectKey,
} from "@onelife/death-verdict";
import { loadDeath, newFileCache, type FileCache, type LoadedDeath } from "@onelife/read-models";

/**
 * The verdict sweep (death-verdict spec 4.4): classifies every ended life from its raw lines and
 * stores the verdict in `death_verdicts`; for a trap death it also writes, or removes, the trap
 * kill in `kills` (spec 2.4).
 *
 * ⚠️ Called by the projector loop only when the fold has caught up (`runLoopOnce`). During a
 *    re-fold, half-folded lives must not be classified.
 * ⚠️ The classifier never reads `lives.death_cause` or `events.payload.cause`. The sweep reads
 *    `death_cause` for exactly two things: the invariant that flags a row for review, and the rule
 *    that no trap kill is written for a life the kill line already gave a killer.
 * ⚠️ The sweep never touches a `kills` row whose basis is `kill_line` (the fold's), and the fold
 *    never touches a `trap_placement` row (the sweep's).
 */

/** A death is settled once its file holds a line this far past it on the log clock ... */
export const SETTLE_LOG_SECONDS = 300;
/** ... or once this long has passed on the wall clock since the sweep first saw the life. */
export const SETTLE_WALL_MINUTES = 30;
/** A pass starts no new life after this long ... */
export const PASS_BUDGET_MS = 10_000;
/** ... or after this many lives. */
export const PASS_LIMIT = 50;
/** A life that failed this often is reported as held. */
export const HELD_ATTEMPTS = 3;
/** A row settled by the wall clock is worked out once more after this long. */
export const SECOND_LOOK_HOURS = 24;
const BACKOFF_BASE_S = 30;
const BACKOFF_CAP_S = 6 * 3600;
/** A victim life counts on its own with this much playtime (the qualification rule's). */
const QUALIFY_PLAYTIME_S = 300;

export type SettledBy = "file" | "rotation" | "wall";

export interface SweepLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface SweepOptions {
  now?: Date;
  log: SweepLogger;
  /** `TRAP_KILLS_WRITE`. Off (the default): no trap row is written and any found is removed. */
  trapKillsWrite?: boolean;
  budgetMs?: number;
  limit?: number;
  /** Test seam: the clock the time budget is measured with. */
  clock?: () => number;
}

export interface SweepResult { written: number; failed: number; held: number; rederived: number }

/** A `death_verdict_overrides` row, as read. */
export interface OverrideRow {
  serverId: number; deathFileId: number; deathLineIndex: number;
  cause: string | null; confidence: string | null; objectKey: string | null;
  upstreamCause: string | null; upstreamConfidence: string | null;
  credit: string | null; creditDayzId: string | null; updatedAt: Date;
}

const CONFIDENCES: readonly Confidence[] = ["definitive", "strong", "inferred", "unknown"];
const isConfidence = (v: unknown): v is Confidence => CONFIDENCES.includes(v as Confidence);
const isDayzId = (v: unknown): v is string => typeof v === "string" && /^[0-9A-F]{40}$/.test(v);

/**
 * Why an override row cannot be applied, or null when it can. Values are checked on read against
 * the classifier's own vocabulary: an invalid row is ignored (and listed by verify-verdicts), never
 * half-applied.
 */
export function overrideProblem(o: OverrideRow): string | null {
  if (o.cause != null && !(INTERNAL_CAUSES as readonly string[]).includes(o.cause)) return `unknown cause ${o.cause}`;
  if (o.confidence != null && !isConfidence(o.confidence)) return `unknown confidence ${o.confidence}`;
  if (o.objectKey != null && !isObjectKey(o.objectKey)) return `unknown object key ${o.objectKey}`;
  if (o.upstreamConfidence != null && !isConfidence(o.upstreamConfidence)) return `unknown upstream confidence ${o.upstreamConfidence}`;
  if (o.upstreamConfidence != null && o.upstreamCause == null) return "upstream confidence without an upstream cause";
  if (o.credit != null && o.credit !== "deny" && o.credit !== "grant") return `unknown credit ${o.credit}`;
  if (o.credit === "grant" && !isDayzId(o.creditDayzId)) return "a grant needs credit_dayz_id (a 40-hex player id)";
  return null;
}

/** The verdict with a valid override's non-null fields in place of the classifier's. */
export function applyOverride(v: InternalVerdict, o: OverrideRow | null): { verdict: InternalVerdict; source: "classifier" | "override" } {
  if (!o || overrideProblem(o)) return { verdict: v, source: "classifier" };
  const touches = o.cause != null || o.confidence != null || o.objectKey != null || o.upstreamCause != null;
  if (!touches) return { verdict: v, source: "classifier" };
  const out: InternalVerdict = structuredClone(v);
  if (o.cause != null) out.cause = o.cause as InternalVerdict["cause"];
  if (o.confidence != null) out.confidence = o.confidence as Confidence;
  if (o.objectKey != null) out.object = { key: o.objectKey as ObjectKey, className: v.object?.className ?? null, text: v.object?.text ?? null };
  if (o.upstreamCause != null) out.upstream = { cause: o.upstreamCause, confidence: (o.upstreamConfidence as Confidence | null) ?? "unknown" };
  return { verdict: out, source: "override" };
}

/** Spec 4.4's invariant: a kill-line attribution exactly when the life row says pvp. */
export function needsReview(v: InternalVerdict, deathCause: string | null): boolean {
  const named = v.attribution?.basis === "kill_line" || v.attribution?.basis === "kill_line_driver";
  return named !== (deathCause === "pvp");
}

/** The victim life, as the credit's policy half reads it. */
export interface CreditLife {
  id: number; serverId: number; playerId: number; startedAt: Date; endedAt: Date;
  playtimeSeconds: number; deathCause: string | null; victimDayzId: string; victimGamertag: string;
}

/** A trap kill to write into `kills`. */
export interface TrapKillRow {
  serverId: number; killerPlayerId: number; killerGamertag: string; victimGamertag: string; victimPlayerId: number;
  victimLifeId: number; weapon: string; occurredAt: Date; creditSource: "classifier" | "override";
}

const WEAPON: Record<string, string> = { tripwire: "Tripwire", land_mine: "Land mine" };

/** Test 6: the placer's `players` row, by id. */
async function placerRow(db: Database, dayzId: string): Promise<{ id: number; gamertag: string } | null> {
  const r = (await db.execute<{ id: string; gamertag: string }>(sql`
    SELECT id, gamertag FROM players WHERE dayz_id = ${dayzId} LIMIT 1`)) as unknown as { id: string; gamertag: string }[];
  return r[0] ? { id: Number(r[0].id), gamertag: r[0].gamertag } : null;
}

/**
 * Test 7: the victim's life counts in its own right — 300 s of playtime, or a kill-line kill of
 * theirs inside the life. ⚠️ A trap kill of the victim's own does not count here: one credit must
 * not depend on another, nor on the order the sweep reaches two deaths. Kills are matched to the
 * victim by player id (a row without an id by name).
 */
export async function lifeCountsOnItsOwn(db: Database, life: CreditLife): Promise<boolean> {
  if (life.playtimeSeconds >= QUALIFY_PLAYTIME_S) return true;
  const r = (await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM kills
    WHERE server_id = ${life.serverId} AND basis = 'kill_line'
      AND (killer_player_id = ${life.playerId}
           OR (killer_player_id IS NULL AND lower(killer_gamertag) = lower(${life.victimGamertag})))
      AND occurred_at >= ${life.startedAt.toISOString()} AND occurred_at <= ${life.endedAt.toISOString()}`)) as unknown as { n: string }[];
  return Number(r[0]?.n ?? 0) > 0;
}

/**
 * The policy half of the trap-kill bar (spec 2.4): from the classifier's evidence to the outcome
 * that is stored, and the `kills` row to write when the kill stands.
 *
 * - `evidence_passes` -> test 6 (the placer has a `players` row) -> test 7 (the victim's life
 *   counts on its own) -> `credited`.
 * - An operator `deny` -> `denied`, no row.
 * - An operator `grant` replaces tests 2, 3 and 5 only: it gives `granted` (credit source
 *   `override`) when tests 1, 4, 6 and 7 hold for the granted id, and is otherwise reported as
 *   refused with the test that failed. ⚠️ Test 7 has no exception, for a grant either.
 *
 * Never returns `evidence_passes`: that word is the classifier's, and is not a kill.
 */
export async function resolveCredit(db: Database, life: CreditLife, verdict: InternalVerdict, override: OverrideRow | null):
  Promise<{ credit: CreditEvidence | null; row: TrapKillRow | null }> {
  const base = verdict.evidence.credit;
  const o = override && !overrideProblem(override) ? override : null;
  // Not a trap or mine death the classifier recognised: nothing to credit, and a grant cannot
  // make it one (test 1).
  if (!base) return { credit: null, row: null };
  const credit: CreditEvidence = structuredClone(base);
  const device = TRAP_DEVICE_OF_CAUSE[verdict.cause];
  const refuse = (n: CreditEvidence["refusedBy"], flag?: string) => {
    credit.outcome = "refused"; credit.refusedBy = n;
    if (flag && !credit.flags.includes(flag)) credit.flags.push(flag);
    return { credit, row: null };
  };

  if (o?.credit === "deny") {
    credit.outcome = "denied"; credit.refusedBy = null;
    return { credit, row: null };
  }

  let placerId: string | null;
  let source: "classifier" | "override";
  if (o?.credit === "grant") {
    source = "override";
    placerId = o.creditDayzId;
    // test 1 stands: a grant cannot make a death a trap kill
    if (base.outcome === "not_applicable" || base.refusedBy === 1 || !device) return refuse(1, "grant_refused");
    // test 4 for the granted id
    if (placerId === life.victimDayzId) return refuse(4, "grant_refused");
    credit.placerDayzId = placerId;
    if (base.placerDayzId !== placerId) { credit.placement = null; credit.distanceM = null; credit.ageHours = null; credit.boots = null; }
  } else {
    if (base.outcome !== "evidence_passes") return { credit, row: null };
    source = "classifier";
    placerId = base.placerDayzId;
    if (!device || !placerId) return refuse(1);
  }

  const placer = await placerRow(db, placerId!);
  if (!placer) return refuse(6, source === "override" ? "grant_refused" : undefined);
  if (!(await lifeCountsOnItsOwn(db, life))) return refuse(7, source === "override" ? "grant_refused" : undefined);

  credit.outcome = source === "override" ? "granted" : "credited";
  credit.refusedBy = null;
  return {
    credit,
    row: {
      serverId: life.serverId, killerPlayerId: placer.id, killerGamertag: placer.gamertag,
      victimGamertag: life.victimGamertag, victimPlayerId: life.playerId, victimLifeId: life.id,
      weapon: WEAPON[device]!, occurredAt: life.endedAt, creditSource: source,
    },
  };
}

/** Which settle test a loaded death passes now, or null (spec 4.4). */
export function settledBy(d: Pick<LoadedDeath, "deathTs" | "deathFileLastTs" | "rotated">, firstSeenAt: Date, now: Date): SettledBy | null {
  if (d.deathFileLastTs != null && d.deathFileLastTs >= d.deathTs + SETTLE_LOG_SECONDS) return "file";
  if (d.rotated) return "rotation";
  if (now.getTime() - firstSeenAt.getTime() >= SETTLE_WALL_MINUTES * 60_000) return "wall";
  return null;
}

/** The parts of a verdict a change of which is worth logging on a second look. */
function digest(v: Pick<typeof deathVerdicts.$inferInsert, "cause" | "confidence" | "rule" | "attrRole" | "attrDayzId" | "upstreamCause" | "objectText" | "evidence">): string {
  const credit = (v.evidence as { credit?: CreditEvidence | null } | undefined)?.credit ?? null;
  return JSON.stringify([v.cause, v.confidence, v.rule, v.attrRole, v.attrDayzId, v.upstreamCause, v.objectText, credit?.outcome ?? null, credit?.placerDayzId ?? null]);
}

interface LifeRow {
  id: number; serverId: number; playerId: number; startedAt: Date; endedAt: Date; playtimeSeconds: number;
  deathCause: string | null; dayzId: string | null; gamertag: string;
}

async function lifeRow(db: Database, lifeId: number): Promise<LifeRow | null> {
  const r = (await db.execute<Record<string, unknown>>(sql`
    SELECT l.id, l.server_id, l.player_id, l.started_at, l.ended_at, l.playtime_seconds, l.death_cause, p.dayz_id, p.gamertag
    FROM lives l JOIN players p ON p.id = l.player_id WHERE l.id = ${lifeId}`)) as unknown as Record<string, unknown>[];
  const x = r[0];
  if (!x || x.ended_at == null) return null;
  return {
    id: Number(x.id), serverId: Number(x.server_id), playerId: Number(x.player_id), startedAt: new Date(x.started_at as string),
    endedAt: new Date(x.ended_at as string), playtimeSeconds: Number(x.playtime_seconds), deathCause: (x.death_cause as string | null) ?? null,
    dayzId: (x.dayz_id as string | null) ?? null, gamertag: x.gamertag as string,
  };
}

export async function overrideFor(db: Database, deathFileId: number, deathLineIndex: number): Promise<OverrideRow | null> {
  const r = (await db.execute<Record<string, unknown>>(sql`
    SELECT * FROM death_verdict_overrides WHERE death_file_id = ${deathFileId} AND death_line_index = ${deathLineIndex}`)) as unknown as Record<string, unknown>[];
  const x = r[0];
  if (!x) return null;
  return {
    serverId: Number(x.server_id), deathFileId: Number(x.death_file_id), deathLineIndex: Number(x.death_line_index),
    cause: (x.cause as string | null) ?? null, confidence: (x.confidence as string | null) ?? null, objectKey: (x.object_key as string | null) ?? null,
    upstreamCause: (x.upstream_cause as string | null) ?? null, upstreamConfidence: (x.upstream_confidence as string | null) ?? null,
    credit: (x.credit as string | null) ?? null, creditDayzId: (x.credit_dayz_id as string | null) ?? null, updatedAt: new Date(x.updated_at as string),
  };
}

/** Everything one derivation produces, before it is written. */
export interface Derivation {
  life: LifeRow;
  loaded: LoadedDeath;
  classifier: InternalVerdict;
  verdict: InternalVerdict;
  source: "classifier" | "override";
  override: OverrideRow | null;
  needsReview: boolean;
  credit: CreditEvidence | null;
  trapRow: TrapKillRow | null;
}

/** Works one life out from its raw lines, override and credit policy included. Writes nothing. */
export async function deriveLife(db: Database, lifeId: number, cache: FileCache): Promise<Derivation> {
  const life = await lifeRow(db, lifeId);
  if (!life) throw new Error("life not found or not ended");
  const loaded = await loadDeath(db, lifeId, cache);
  const classifier = classifyDeath(loaded.ctx);
  const override = await overrideFor(db, classifier.deathRef.admFileId, classifier.deathRef.lineIndex);
  const { verdict, source } = applyOverride(classifier, override);
  const review = needsReview(verdict, life.deathCause);
  const { credit, row } = await resolveCredit(db, {
    id: life.id, serverId: life.serverId, playerId: life.playerId, startedAt: life.startedAt, endedAt: life.endedAt,
    playtimeSeconds: life.playtimeSeconds, deathCause: life.deathCause, victimDayzId: life.dayzId ?? "", victimGamertag: life.gamertag,
  }, verdict, override);
  return { life, loaded, classifier, verdict, source, override, needsReview: review, credit, trapRow: row };
}

/** The `death_verdicts` row for a derivation. */
export function verdictRow(d: Derivation, settled: SettledBy, now: Date): typeof deathVerdicts.$inferInsert {
  const v = d.verdict;
  return {
    lifeId: d.life.id, classifierVersion: CLASSIFIER_VERSION, source: d.source, settledBy: settled,
    deathFileId: v.deathRef.admFileId, deathLineIndex: v.deathRef.lineIndex, deathAt: new Date(v.deathAt),
    cause: v.cause, confidence: v.confidence, mechanismStated: v.mechanismStated,
    objectKey: v.object?.key ?? null, objectClass: v.object?.className ?? null, objectText: v.object?.text ?? null,
    upstreamCause: v.upstream?.cause ?? null, upstreamConfidence: v.upstream?.confidence ?? null,
    coCauses: v.coCauses, conditions: v.conditions,
    attrRole: v.attribution?.role ?? null, attrBasis: v.attribution?.basis ?? null, attrDayzId: v.attribution?.dayzId ?? null,
    attrGamertag: v.attribution?.gamertag ?? null, attrConfidence: v.attribution?.confidence ?? null,
    rule: v.rule,
    evidence: { ...v.evidence, credit: d.credit, deathLines: v.deathLines },
    needsReview: d.needsReview,
    overrideSeenAt: d.override?.updatedAt ?? null,
    classifiedAt: now,
  };
}

/**
 * Writes one derivation in ONE transaction: the verdict, the life's trap kill (removed, then
 * written again only when it stands and the switch is on), and the queue row deleted.
 */
export async function writeDerivation(db: Database, d: Derivation, settled: SettledBy, now: Date, trapKillsWrite: boolean,
  extraEvidence: Record<string, unknown> = {}): Promise<typeof deathVerdicts.$inferInsert> {
  const row = verdictRow(d, settled, now);
  row.evidence = { ...(row.evidence as object), ...extraEvidence };
  const credit = (row.evidence as { credit: CreditEvidence | null }).credit;
  // ⚠️ "evidence_passes" is the classifier's word and is not a kill; a stored row must say what
  // the policy half decided.
  if (credit?.outcome === "evidence_passes") throw new Error("verdict sweep: credit outcome left at evidence_passes");
  const write = trapKillsWrite && d.trapRow != null && !d.needsReview && d.life.deathCause !== "pvp";
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM kills WHERE victim_life_id = ${d.life.id} AND basis = 'trap_placement'`);
    if (write) {
      const t = d.trapRow!;
      const inserted = await tx.insert(kills).values({
        serverId: t.serverId, killerGamertag: t.killerGamertag, killerPlayerId: t.killerPlayerId, victimGamertag: t.victimGamertag,
        victimPlayerId: t.victimPlayerId, victimLifeId: t.victimLifeId, weapon: t.weapon, distance: null, occurredAt: t.occurredAt,
        basis: "trap_placement", creditSource: t.creditSource,
      }).onConflictDoNothing().returning({ id: kills.id });
      // A kill-line row already holds this victim life (one kill per victim life): it wins, and the
      // stored outcome must not claim a row that is not there.
      if (inserted.length === 0 && credit) credit.flags = [...credit.flags, "kill_line_row_exists"];
    }
    const { lifeId: _l, ...set } = row;
    await tx.insert(deathVerdicts).values(row).onConflictDoUpdate({ target: deathVerdicts.lifeId, set });
    await tx.execute(sql`DELETE FROM death_verdict_queue WHERE life_id = ${d.life.id}`);
  });
  return row;
}

async function recordFailure(db: Database, lifeId: number, err: unknown, now: Date): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  await db.execute(sql`
    INSERT INTO death_verdict_queue (life_id, first_seen_at, attempts, last_error, next_attempt_at)
    VALUES (${lifeId}, ${now.toISOString()}, 1, ${message}, ${new Date(now.getTime() + BACKOFF_BASE_S * 1000).toISOString()})
    ON CONFLICT (life_id) DO UPDATE SET
      attempts = death_verdict_queue.attempts + 1,
      last_error = EXCLUDED.last_error,
      next_attempt_at = ${now.toISOString()}::timestamptz
        + make_interval(secs => least(${BACKOFF_BASE_S} * power(2, death_verdict_queue.attempts), ${BACKOFF_CAP_S}))`);
}

/**
 * One pass. Oldest death first; stops starting new lives after the time budget or the limit.
 */
export async function sweepVerdicts(db: Database, opts: SweepOptions): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? PASS_BUDGET_MS;
  const limit = opts.limit ?? PASS_LIMIT;
  const trapKillsWrite = opts.trapKillsWrite ?? false;
  const cache = newFileCache();
  const nowIso = now.toISOString();
  const res: SweepResult = { written: 0, failed: 0, held: 0, rederived: 0 };
  let started_n = 0;
  const overBudget = () => started_n >= limit || clock() - started >= budget;

  // Candidates: no verdict at this version, or an override changed since it was applied; and not
  // backing off. Oldest death first.
  const cands = (await db.execute<{ id: string }>(sql`
    SELECT l.id FROM lives l
    LEFT JOIN death_verdicts v ON v.life_id = l.id
    LEFT JOIN death_verdict_queue q ON q.life_id = l.id
    LEFT JOIN death_verdict_overrides o ON o.death_file_id = v.death_file_id AND o.death_line_index = v.death_line_index
    WHERE l.ended_at IS NOT NULL
      AND (v.life_id IS NULL OR v.classifier_version < ${CLASSIFIER_VERSION}
           -- ⚠️ milliseconds on both sides: updated_at has microseconds, and override_seen_at is
           -- written back from a JS Date, which keeps milliseconds. Compared whole, every life with
           -- an override would be rewritten on every pass.
           OR (o.death_file_id IS NOT NULL
               AND date_trunc('milliseconds', o.updated_at) IS DISTINCT FROM date_trunc('milliseconds', v.override_seen_at))
           OR (o.death_file_id IS NULL AND v.override_seen_at IS NOT NULL))
      AND (q.life_id IS NULL OR q.next_attempt_at <= ${nowIso}::timestamptz)
    ORDER BY l.ended_at, l.id
    LIMIT ${limit * 4}`)) as unknown as { id: string }[];
  const ids = cands.map((c) => Number(c.id));
  if (ids.length) {
    // first sight: the wall-clock settle fallback measures from here, not from ended_at
    await db.execute(sql`
      INSERT INTO death_verdict_queue (life_id, first_seen_at, next_attempt_at)
      SELECT x, ${nowIso}::timestamptz, ${nowIso}::timestamptz FROM unnest(${sql.raw(`ARRAY[${ids.join(",")}]::bigint[]`)}) AS x
      ON CONFLICT (life_id) DO NOTHING`);
  }
  const firstSeen = new Map<number, Date>();
  if (ids.length) {
    const q = (await db.execute<{ life_id: string; first_seen_at: string }>(sql`
      SELECT life_id, first_seen_at FROM death_verdict_queue WHERE life_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)) as unknown as { life_id: string; first_seen_at: string }[];
    for (const r of q) firstSeen.set(Number(r.life_id), new Date(r.first_seen_at));
  }

  for (const lifeId of ids) {
    if (overBudget()) break;
    started_n++;
    try {
      const d = await deriveLife(db, lifeId, cache);
      if (d.loaded.unknownZone) opts.log.warn({ serverId: d.life.serverId }, "verdict_sweep.unknown_zone");
      const settled = settledBy(d.loaded, firstSeen.get(lifeId) ?? now, now);
      if (!settled) continue;
      await writeDerivation(db, d, settled, now, trapKillsWrite);
      res.written++;
    } catch (err) {
      res.failed++;
      await recordFailure(db, lifeId, err, now);
      opts.log.warn({ lifeId, err: err instanceof Error ? err.message : String(err) }, "verdict_sweep.failed");
    }
  }

  // Second look: a row settled by the wall clock is worked out once more, when its file has since
  // passed +300 s, its server has rotated, or after 24 h.
  if (!overBudget()) {
    const wall = (await db.execute<{ life_id: string; classified_at: string }>(sql`
      SELECT v.life_id, v.classified_at FROM death_verdicts v
      WHERE v.settled_by = 'wall' AND v.classifier_version = ${CLASSIFIER_VERSION} AND NOT (v.evidence ? 'secondLookAt')
      ORDER BY v.classified_at LIMIT ${limit}`)) as unknown as { life_id: string; classified_at: string }[];
    for (const w of wall) {
      if (overBudget()) break;
      started_n++;
      const lifeId = Number(w.life_id);
      try {
        const before = (await db.select().from(deathVerdicts).where(sql`${deathVerdicts.lifeId} = ${lifeId}`))[0];
        const d = await deriveLife(db, lifeId, cache);
        const now2 = settledBy(d.loaded, new Date(8.64e15), now); // file or rotation only
        const old = now.getTime() - new Date(w.classified_at).getTime() >= SECOND_LOOK_HOURS * 3600_000;
        if (now2 == null && !old) continue;
        const settled: SettledBy = now2 ?? "wall";
        const row = await writeDerivation(db, d, settled, now, trapKillsWrite, settled === "wall" ? { secondLookAt: nowIso } : {});
        res.rederived++;
        if (before && digest(before) !== digest(row)) {
          opts.log.info({ lifeId, before: { cause: before.cause, confidence: before.confidence, rule: before.rule }, after: { cause: row.cause, confidence: row.confidence, rule: row.rule } }, "verdict_sweep.rederived");
        }
      } catch (err) {
        res.failed++;
        opts.log.warn({ lifeId, err: err instanceof Error ? err.message : String(err) }, "verdict_sweep.second_look_failed");
      }
    }
  }

  const held = (await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM death_verdict_queue WHERE attempts >= ${HELD_ATTEMPTS}`)) as unknown as { n: string }[];
  res.held = Number(held[0]?.n ?? 0);
  if (res.held > 0) opts.log.error({ held: res.held }, "verdict_sweep.held");
  return res;
}
