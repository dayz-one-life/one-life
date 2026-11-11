import type { Database } from "@onelife/db";
import { deathVerdicts, kills, lives, players } from "@onelife/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  pendingPublicDeath, toPublicDeath,
  type AttributionBasis, type Condition, type Confidence, type InternalCause, type ObjectKey, type PublicDeath,
  type StoredVerdict, type TrapCredit, type TrapDevice,
} from "@onelife/death-verdict";

/**
 * The public death of a life, read from the stored verdict (stage 4).
 *
 * ⚠️ This is the only reader of `death_verdicts` that serves a page. The stored row holds things
 * that must never leave the server — who probably set a trap, who was nearby, raw class names,
 * rule ids, the logout marker. So:
 *   - only NAMED columns are selected, never `select()` of the whole row, and `attr_gamertag`,
 *     `attr_dayz_id`, `object_text`, `evidence` are not among them;
 *   - `rule` is selected for one boolean (rule A14 is the only form that may print "Shot"; step 2
 *     says to set that flag from the rule, never by elimination) and is never returned;
 *   - everything goes out through `toPublicDeath`, which fails closed on any stored value it does
 *     not know;
 *   - the only gamertag that can come from here is a trap-setter's, and only from a `kills` row
 *     with basis `trap_placement` (the sweep writes one only when the credit stands). A placer who
 *     failed the bar has no such row and appears nowhere.
 *
 * A row at ANY classifier version is final unless it is `needs_review`: an older row is still the
 * best reading there is, and the sweep rewrites it in place. No row (or a row held for review) is
 * pending: the death line's own coarse word, or "Awaiting the record". There is no read-time
 * classification.
 */

/** The slice of a life row these readers need. A full `lives` row satisfies it. `endReason` comes
 *  from `applyRetirement`; a bare row with `endedAt` set is a death. */
export interface PublicDeathLife {
  id: number;
  endedAt: Date | null;
  endReason?: "death" | "server_retired" | null;
  deathCause: string | null;
  deathByGamertag: string | null;
  deathWeapon: string | null;
  deathDistance: number | null;
}

/** An obituary's natural key: what the article was frozen against. */
export interface ArticleLifeKey { serverId: number; gamertag: string; lifeStartedAt: Date }

export function articleKey(k: ArticleLifeKey): string {
  return `${k.serverId}:${k.gamertag.toLowerCase()}:${k.lifeStartedAt.getTime()}`;
}

const isDeath = (l: PublicDeathLife) => l.endedAt != null && (l.endReason ?? "death") === "death";

const VERDICT_COLS = {
  lifeId: deathVerdicts.lifeId,
  cause: deathVerdicts.cause,
  confidence: deathVerdicts.confidence,
  mechanismStated: deathVerdicts.mechanismStated,
  objectKey: deathVerdicts.objectKey,
  upstreamCause: deathVerdicts.upstreamCause,
  upstreamConfidence: deathVerdicts.upstreamConfidence,
  conditions: deathVerdicts.conditions,
  attrBasis: deathVerdicts.attrBasis,
  needsReview: deathVerdicts.needsReview,
  rule: deathVerdicts.rule,
} as const;

type VerdictRow = {
  lifeId: number; cause: string; confidence: string; mechanismStated: boolean; objectKey: string | null;
  upstreamCause: string | null; upstreamConfidence: string | null; conditions: string[]; attrBasis: string | null;
  needsReview: boolean; rule: string;
};

/** The stored row as presentation may read it. The casts are a hope, not a guarantee:
 *  `toPublicDeath` re-checks every value at run time. */
function storedOf(r: VerdictRow): StoredVerdict {
  return {
    cause: r.cause as InternalCause,
    confidence: r.confidence as Confidence,
    mechanismStated: r.mechanismStated,
    objectKey: (r.objectKey as ObjectKey | null) ?? null,
    upstream: r.upstreamCause != null ? { cause: r.upstreamCause, confidence: (r.upstreamConfidence ?? "unknown") as Confidence } : null,
    attrBasis: (r.attrBasis as AttributionBasis | null) ?? null,
    ownerlessFirearm: r.rule === "A14",
    conditions: (r.conditions ?? []) as Condition[],
  };
}

async function verdictRows(db: Database, lifeIds: number[]): Promise<Map<number, VerdictRow>> {
  if (lifeIds.length === 0) return new Map();
  const rows = await db.select(VERDICT_COLS).from(deathVerdicts).where(inArray(deathVerdicts.lifeId, lifeIds));
  return new Map(rows.map((r) => [Number(r.lifeId), { ...r, lifeId: Number(r.lifeId) }]));
}

const DEVICE_OF_WEAPON: Record<string, TrapDevice> = { Tripwire: "tripwire", "Land mine": "land_mine" };

/**
 * The trap kill credited for each victim life: the life's `kills` row with basis
 * `trap_placement`, joined to `players` on `killer_player_id` so a rename since the row was
 * written follows (spec 2.4). Named columns only. A row whose weapon is not one of the two trap
 * words is ignored rather than guessed at.
 */
export async function getTrapCreditsForVictimLives(db: Database, lifeIds: number[]): Promise<Map<number, TrapCredit>> {
  const out = new Map<number, TrapCredit>();
  if (lifeIds.length === 0) return out;
  const rows = await db
    .select({ lifeId: kills.victimLifeId, gamertag: players.gamertag, weapon: kills.weapon, creditSource: kills.creditSource })
    .from(kills)
    .innerJoin(players, eq(players.id, kills.killerPlayerId))
    .where(and(eq(kills.basis, "trap_placement"), inArray(kills.victimLifeId, lifeIds)));
  for (const r of rows) {
    const device = r.weapon != null && Object.hasOwn(DEVICE_OF_WEAPON, r.weapon) ? DEVICE_OF_WEAPON[r.weapon]! : null;
    if (r.lifeId == null || !device) continue;
    out.set(Number(r.lifeId), { gamertag: r.gamertag, device, byOperator: r.creditSource === "override" });
  }
  return out;
}

export async function getTrapCreditForVictimLife(db: Database, lifeId: number): Promise<TrapCredit | null> {
  return (await getTrapCreditsForVictimLives(db, [lifeId])).get(lifeId) ?? null;
}

function publicOf(life: PublicDeathLife, row: VerdictRow | undefined, credit: TrapCredit | null): PublicDeath {
  if (!row || row.needsReview) return pendingPublicDeath(life);
  return toPublicDeath(storedOf(row), life, credit);
}

/** The public death of one life; null unless the life ended in a death (open and retired lives
 *  have no death to tell). */
export async function getPublicDeath(db: Database, life: PublicDeathLife): Promise<PublicDeath | null> {
  return (await getPublicDeathsForLives(db, [life])).get(life.id) ?? null;
}

/** The batch form: one entry per life that ended in a death. */
export async function getPublicDeathsForLives(db: Database, ls: PublicDeathLife[]): Promise<Map<number, PublicDeath>> {
  const dead = ls.filter(isDeath);
  const ids = dead.map((l) => l.id);
  const [rows, credits] = await Promise.all([verdictRows(db, ids), getTrapCreditsForVictimLives(db, ids)]);
  return new Map(dead.map((l) => [l.id, publicOf(l, rows.get(l.id), credits.get(l.id) ?? null)]));
}

/**
 * The live FINAL public death behind each article key. A pending life (no row, or a row held for
 * review) and a life that no longer resolves are left out, so the caller falls back to the
 * article's frozen values: a pending verdict never replaces what an article already says
 * (spec 6.2).
 *
 * `articles.gamertag` is frozen at publish time, so the life is found through the player's whole
 * alias history (`player_gamertags`), as `life-timeline.ts` finds the article.
 */
export async function getPublicDeathsForArticles(db: Database, keys: ArticleLifeKey[]): Promise<Map<string, PublicDeath>> {
  const out = new Map<string, PublicDeath>();
  if (keys.length === 0) return out;
  const conds = keys.map((k) => sql`(${lives.serverId} = ${k.serverId} AND ${lives.startedAt} = ${k.lifeStartedAt.toISOString()}::timestamptz
    AND ${lives.playerId} IN (SELECT pg.player_id FROM player_gamertags pg WHERE lower(pg.gamertag) = ${k.gamertag.toLowerCase()}))`);
  const found = await db
    .select({
      id: lives.id, serverId: lives.serverId, startedAt: lives.startedAt, endedAt: lives.endedAt,
      deathCause: lives.deathCause, deathByGamertag: lives.deathByGamertag, deathWeapon: lives.deathWeapon,
      deathDistance: lives.deathDistance, playerId: lives.playerId,
    })
    .from(lives)
    .where(sql.join(conds, sql` OR `));
  if (found.length === 0) return out;
  const ids = found.map((l) => Number(l.id));
  const [rows, credits, aliases] = await Promise.all([
    verdictRows(db, ids),
    getTrapCreditsForVictimLives(db, ids),
    db.execute(sql`SELECT player_id, lower(gamertag) AS gamertag FROM player_gamertags WHERE player_id IN (${sql.join(found.map((l) => sql`${l.playerId}`), sql`, `)})`),
  ]);
  const namesOf = new Map<number, Set<string>>();
  for (const a of aliases as unknown as { player_id: number | string; gamertag: string }[]) {
    const pid = Number(a.player_id);
    if (!namesOf.has(pid)) namesOf.set(pid, new Set());
    namesOf.get(pid)!.add(a.gamertag);
  }
  for (const k of keys) {
    const life = found.find((l) => l.serverId === k.serverId && l.startedAt.getTime() === k.lifeStartedAt.getTime()
      && (namesOf.get(Number(l.playerId))?.has(k.gamertag.toLowerCase()) ?? false));
    if (!life || life.endedAt == null) continue;
    const id = Number(life.id);
    const row = rows.get(id);
    if (!row || row.needsReview) continue;
    out.set(articleKey(k), toPublicDeath(storedOf(row), life, credits.get(id) ?? null));
  }
  return out;
}
