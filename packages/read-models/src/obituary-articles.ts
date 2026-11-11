import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  CAPTION, OBJECT_LABEL, PUBLIC_INFERRED, PUBLIC_ROWS, type ObjectLabel, type PublicCauseKey, type PublicDeath,
} from "@onelife/death-verdict";
import { articleKey, getPublicDeathsForArticles, type ArticleLifeKey } from "./death-verdicts.js";

export const OBITUARIES_FEED_PAGE_SIZE = 20;

/**
 * R5d rich-body block union. `articles.body_blocks` is jsonb and NULL on every pre-R5d row, so
 * every consumer must handle null by rendering the flat `body`.
 */
export type ArticleBlock =
  | { type: "para"; text: string }
  | { type: "subhead"; text: string }
  | { type: "quote"; text: string; attribution: string }
  | { type: "list"; items: string[] };

/**
 * Migration 0016 made the subject columns nullable for institutional editorial pieces. For an
 * obituary or a birth notice a null subject is DATA CORRUPTION, not a valid state — the article
 * is keyed by that tuple. Throwing is deliberate: rendering an article with a missing subject
 * onto a public page is worse than a 500, because it looks like a real article about nobody.
 *
 * `gamertag` is always required and always checked. Different obituary/birth-notice queries
 * select different subsets of the other 0016-nullable subject columns (`map`, `lifeNumber`, a
 * `lifeStartedAt` sometimes aliased to `bornAt`, …) — pass whichever ones THIS row selects as
 * `otherSubjectColumns` and each is both runtime-checked and narrowed away from `null` in the
 * return type, so a caller never needs a bare `!` (or an `as` cast) on a subject column again. A
 * caller that selects none of them (e.g. the Discord notifier's `{id, slug, gamertag}` query) can
 * omit the argument entirely — the guard never demands a column nobody asked for.
 */
export function assertSubjectful<
  T extends { gamertag: string | null; slug: string | null },
  const K extends keyof T = never,
>(
  row: T,
  kind: string,
  otherSubjectColumns: readonly K[] = [],
): T & { gamertag: string } & { [P in K]: NonNullable<T[P]> } {
  if (row.gamertag == null) {
    throw new Error(`${kind} article ${row.slug ?? "(no slug)"} has a null gamertag — corrupt row`);
  }
  for (const col of otherSubjectColumns) {
    if (row[col] == null) {
      throw new Error(`${kind} article ${row.slug ?? "(no slug)"} has a null ${String(col)} — corrupt row`);
    }
  }
  return row as T & { gamertag: string } & { [P in K]: NonNullable<T[P]> };
}

export interface ObituaryCard {
  slug: string;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  timeAliveSeconds: number;
  kills: number;
  longestKillMeters: number | null;
  cause: string | null;
  deathAt: Date;
  /**
   * The death this article sits above (spec 6.2): the LIVE final verdict when there is one, else
   * the strings frozen into the article when it was written (`facts.death`, step 8 on), else null
   * and the reader falls back to `cause` / `verdict` (today's vocabulary). A pending verdict never
   * replaces frozen values. ⚠️ A trap credit comes only from the live read, never from the frozen
   * strings: a credit that has since been denied must not survive in an old article's facts.
   */
  death: ArticleDeath | null;
}

/** The hedged strings an article froze when it was written. `status: "frozen"` tells a reader it
 *  is not live, so it can be cached for less certainty than a final verdict would allow. */
export interface FrozenDeath {
  status: "frozen";
  key: string;
  tag: string | null;
  certainty: string;
  label: string;
  detail: string | null;
  sentence: string;
  caption: string | null;
}
export type ArticleDeath = PublicDeath | FrozenDeath;

export interface ObituariesFeed {
  rows: ObituaryCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ObituaryArticle extends ObituaryCard {
  body: string;
  bodyBlocks: ArticleBlock[] | null;
  pullQuote: { text: string; attribution: string } | null;
  sessions: number;
  killerGamertag: string | null;
  weapon: string | null;
  verdict: { cause: string; confidence: "high" | "low"; conditions: string[] } | null;
}

type FactsSnapshot = {
  sessions?: number; killerGamertag?: string | null; weapon?: string | null;
  verdict?: { cause?: string; confidence?: "high" | "low"; conditions?: string[] } | null;
  /** Frozen at write time from step 8 on (spec 3.6): `{ key, tag, certainty, label, detail, sentence, caption }`. */
  death?: unknown;
};

const str = (v: unknown): v is string => typeof v === "string";
const TRAP_KEYS: ReadonlySet<string> = new Set(["tripwire", "land_mine"]);

/**
 * The frozen strings of an article, checked field by field (they are jsonb). Anything malformed is
 * no frozen value at all, and the reader falls back to the article's legacy fields.
 *
 * ⚠️ Two things are checked against the live vocabulary, not trusted from the jsonb:
 *   - An inferred death is shown only while its row has a family and that family's switch
 *     (`PUBLIC_INFERRED`) is on. Spec 2.1: the switch retracts label, sentence, caption and tag
 *     at once, and a frozen value is no exception (it is served whenever the live verdict is
 *     pending: held for review, mid-rebuild, or the life no longer resolving).
 *   - A trap death keeps only its key, its certainty and an object its row can hold; every string
 *     is rebuilt from the row, with no name. Written while a credit stood, the frozen strings may
 *     name the player credited, and a credit can be denied afterwards. Only the live read may
 *     name a trap-setter. The caption is the certainty's own, so a strong trap death keeps "Worked
 *     out from the log".
 */
export function frozenDeathOf(raw: unknown): FrozenDeath | null {
  if (raw == null || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!str(d.key) || !str(d.label) || !str(d.sentence) || !str(d.certainty)) return null;
  const known = Object.hasOwn(PUBLIC_ROWS, d.key);
  const row = known ? PUBLIC_ROWS[d.key as PublicCauseKey] : null;
  if (d.certainty === "inferred") {
    const family = row?.family ?? null;
    if (family == null || PUBLIC_INFERRED[family] !== true) return null;
  }
  if (row && TRAP_KEYS.has(d.key)) {
    const object: ObjectLabel | null = row.detail === "object" && str(d.detail)
      ? (row.objects ?? []).map((k) => OBJECT_LABEL[k]).find((o) => o.short === d.detail) ?? null : null;
    const words = row.stated({ name: null, weapon: null, distance: null, object, conditions: [] });
    return {
      status: "frozen", key: d.key, tag: row.tag, certainty: d.certainty, label: words.label,
      detail: object?.short ?? null, sentence: words.sentence,
      caption: Object.hasOwn(CAPTION, d.certainty) ? CAPTION[d.certainty as keyof typeof CAPTION] : null,
    };
  }
  return {
    status: "frozen",
    key: d.key,
    tag: str(d.tag) ? d.tag : null,
    certainty: d.certainty,
    label: d.label,
    detail: str(d.detail) ? d.detail : null,
    sentence: d.sentence,
    caption: str(d.caption) ? d.caption : null,
  };
}

/** `obituary-v4` and later hedge an inferred cause in the prose; earlier prompts say no cause was
 *  recorded. Null or unparseable is earlier. */
export function promptHedgesInferred(promptVersion: string | null): boolean {
  const m = /^obituary-v(\d+)/.exec(promptVersion ?? "");
  return m != null && Number(m[1]) >= 4;
}

/**
 * The reserved cause tag (the third composed tag: Obituaries / map / cause) follows the PROSE it
 * sits above, by the table in spec 6.2 item 1:
 *   - live definitive or strong: the live family tag, whatever the prompt version;
 *   - live inferred with its family switched on: the family tag only under a prompt that hedges an
 *     inferred cause (v4 on), else "Unknown" — a v3 article says the record knows no cause;
 *   - live inferred with the family off, unknown, withheld: "Unknown" (`toPublicDeath` already
 *     turns a switched-off family into the unknown row);
 *   - pending or missing: the stored tag, except that a frozen inferred death whose family is
 *     now switched off (`frozenDeathOf` withdraws it) shows "Unknown": the switch withdraws the
 *     tag with the label, sentence and caption (spec 2.1).
 * The rewrite happens here, in the read-model, so the web chip and every API client agree.
 * Tags not composed by newsdesk (no leading "Obituaries") are left alone.
 */
export function articleTags(stored: string[], live: PublicDeath | null, promptVersion: string | null, frozenDeath: unknown = null): string[] {
  if (stored.length < 3 || stored[0] !== "Obituaries") return stored;
  let tag: string;
  if (!live || live.status !== "final") {
    if (!frozenInferredWithdrawn(frozenDeath)) return stored;
    tag = "Unknown";
  } else if (live.certainty === "definitive" || live.certainty === "strong") tag = live.tag ?? "Unknown";
  else if (live.certainty === "inferred") tag = live.tag && promptHedgesInferred(promptVersion) ? live.tag : "Unknown";
  else tag = "Unknown";
  const head = [stored[0]!, stored[1]!, tag];
  const rest = stored.slice(3).filter((t) => t.toLowerCase() !== tag.toLowerCase());
  return [...head, ...rest];
}

/** A frozen death that was written inferred and that `frozenDeathOf` now withdraws. */
function frozenInferredWithdrawn(raw: unknown): boolean {
  return raw != null && typeof raw === "object" && (raw as { certainty?: unknown }).certainty === "inferred" && frozenDeathOf(raw) === null;
}

/** What every article read selects to find and present its death. Not returned. */
export const DEATH_KEY_COLS = {
  keyServerId: articles.serverId,
  keyGamertag: articles.gamertag,
  keyLifeStartedAt: articles.lifeStartedAt,
  promptVersion: articles.promptVersion,
  frozenDeath: sql<unknown>`${articles.facts}->'death'`,
} as const;

interface DeathKeyed {
  keyServerId: number | null; keyGamertag: string | null; keyLifeStartedAt: Date | null;
  promptVersion: string | null; frozenDeath: unknown; tags?: string[] | null;
}

/**
 * Attach `death` (live final, else frozen, else null) and the rewritten tags to article rows.
 * One batched verdict read for the whole page.
 */
export async function withArticleDeaths<T extends DeathKeyed>(db: Database, rows: T[]):
  Promise<(Omit<T, keyof DeathKeyed> & { death: ArticleDeath | null; tags: string[] })[]> {
  const keyOf = (r: T): ArticleLifeKey | null => r.keyServerId != null && r.keyGamertag != null && r.keyLifeStartedAt != null
    ? { serverId: r.keyServerId, gamertag: r.keyGamertag, lifeStartedAt: r.keyLifeStartedAt } : null;
  const keys = rows.map(keyOf).filter((k): k is ArticleLifeKey => k != null);
  const live = await getPublicDeathsForArticles(db, keys);
  return rows.map((r) => {
    const k = keyOf(r);
    const final = k ? live.get(articleKey(k)) ?? null : null;
    const { keyServerId: _a, keyGamertag: _b, keyLifeStartedAt: _c, promptVersion, frozenDeath, tags, ...rest } = r;
    return {
      ...(rest as Omit<T, keyof DeathKeyed>),
      death: final ?? frozenDeathOf(frozenDeath),
      tags: articleTags(tags ?? [], final, promptVersion, frozenDeath),
    };
  });
}

const CARD_COLS = {
  slug: articles.slug,
  gamertag: articles.gamertag,
  map: articles.map,
  mapSlug: articles.mapSlug,
  lifeNumber: articles.lifeNumber,
  headline: articles.headline,
  lede: articles.lede,
  tags: articles.tags,
  timeAliveSeconds: articles.timeAliveSeconds,
  kills: articles.kills,
  longestKillMeters: articles.longestKillMeters,
  cause: articles.cause,
  deathAt: articles.deathAt,
} as const;

const publishedObituary = and(eq(articles.kind, "obituary"), eq(articles.status, "published"));

/** Published obituaries, newest death first. Paginated. Failed stubs are excluded. */
export async function getPublishedObituaries(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<ObituariesFeed> {
  const pageSize = opts.pageSize ?? OBITUARIES_FEED_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);

  const raw = await db
    .select({ ...CARD_COLS, ...DEATH_KEY_COLS })
    .from(articles)
    .where(publishedObituary)
    .orderBy(desc(articles.deathAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(articles)
    .where(publishedObituary);

  const rows = await withArticleDeaths(db, raw);
  return {
    rows: rows.map((one) => {
      const r = assertSubjectful(one, "obituary", ["map", "lifeNumber"]);
      return {
        ...r,
        slug: r.slug!,
        map: r.map,
        lifeNumber: r.lifeNumber,
        headline: r.headline!,
        lede: r.lede!,
        tags: r.tags,
        deathAt: r.deathAt!, // obituaries always carry a non-null death_at (only birth notices go NULL)
      };
    }),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  };
}

/** A single published obituary by its slug, or null (unknown/failed). */
export async function getObituaryBySlug(db: Database, slug: string): Promise<ObituaryArticle | null> {
  const rows = await db
    .select({
      ...CARD_COLS,
      ...DEATH_KEY_COLS,
      body: articles.body,
      bodyBlocks: articles.bodyBlocks,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      facts: articles.facts,
    })
    .from(articles)
    .where(and(publishedObituary, eq(articles.slug, slug)))
    .limit(1);

  if (!rows[0]) return null;
  const [withDeath] = await withArticleDeaths(db, [rows[0]]);
  const r = assertSubjectful(withDeath!, "obituary", ["map", "lifeNumber"]);
  const facts = (r.facts ?? {}) as FactsSnapshot;
  return {
    slug: r.slug!,
    gamertag: r.gamertag,
    map: r.map,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags,
    timeAliveSeconds: r.timeAliveSeconds,
    kills: r.kills,
    longestKillMeters: r.longestKillMeters,
    cause: r.cause,
    deathAt: r.deathAt!, // obituaries always carry a non-null death_at (only birth notices go NULL)
    death: r.death,
    body: r.body ?? "",
    bodyBlocks: (r.bodyBlocks as ArticleBlock[] | null) ?? null,
    pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
    sessions: facts.sessions ?? 0,
    killerGamertag: facts.killerGamertag ?? null,
    weapon: facts.weapon ?? null,
    verdict: facts.verdict?.cause
      ? { cause: facts.verdict.cause, confidence: facts.verdict.confidence ?? "high", conditions: facts.verdict.conditions ?? [] }
      : null,
  };
}
