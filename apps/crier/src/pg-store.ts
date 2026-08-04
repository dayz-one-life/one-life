import { and, desc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { articles, syndications, type Database } from "@onelife/db";
import { sql as dsql } from "drizzle-orm";

export type SyndicationTarget = { slug: string; headline: string; lede: string; channel: string };

/** Published obituaries newer than `since` that a given channel has not successfully posted and
 *  has not exhausted (attempts < maxAttempts). One row per (article, missing channel).
 *
 *  The ledger has NO FK to `articles` (durable vs projection), so the join is by slug, and it is
 *  run once per channel — a per-channel loop of plain two-table left-join queries, rather than a
 *  single cross-join-on-a-channel-array query, because the latter fights drizzle's type system
 *  for no behavioral gain; the tests are the contract, not the join strategy. Each channel's
 *  query is one round-trip; results are merged and sorted oldest-death-first so a backfill reads
 *  chronologically, then sliced to `limit`. */
export async function findSyndicationTargets(
  db: Database,
  opts: { channels: string[]; since: Date; maxAttempts: number; limit: number },
): Promise<SyndicationTarget[]> {
  if (opts.channels.length === 0) return [];

  const perChannel = await Promise.all(
    opts.channels.map(async (channel) => {
      const rows = await db
        .select({
          slug: articles.slug,
          headline: articles.headline,
          lede: articles.lede,
          deathAt: articles.deathAt,
        })
        .from(articles)
        .leftJoin(
          syndications,
          and(eq(syndications.slug, articles.slug), eq(syndications.channel, channel)),
        )
        .where(
          and(
            eq(articles.kind, "obituary"),
            eq(articles.status, "published"),
            gt(articles.deathAt, opts.since),
            isNull(syndications.postedAt),
            or(isNull(syndications.attempts), lt(syndications.attempts, opts.maxAttempts)),
          ),
        );
      return rows
        .filter(
          (r): r is typeof r & { slug: string; headline: string; lede: string; deathAt: Date } =>
            r.slug !== null && r.headline !== null && r.lede !== null && r.deathAt !== null,
        )
        .map((r) => ({ slug: r.slug, headline: r.headline, lede: r.lede, channel, deathAt: r.deathAt }));
    }),
  );

  return perChannel
    .flat()
    .sort((a, b) => a.deathAt.getTime() - b.deathAt.getTime())
    .slice(0, opts.limit)
    .map(({ slug, headline, lede, channel }) => ({ slug, headline, lede, channel }));
}

/** Most recent successful post on a channel, or null if it has never posted.
 *
 *  Backs the Reddit rate cap. Read from the ledger rather than held in memory deliberately: it
 *  survives a worker restart and holds across the fleet, where an in-process timestamp would
 *  reset to "never" on every deploy and let a burst straight through. */
export async function lastPostedAt(db: Database, channel: string): Promise<Date | null> {
  const rows = await db
    .select({ postedAt: syndications.postedAt })
    .from(syndications)
    .where(and(eq(syndications.channel, channel), isNotNull(syndications.postedAt)))
    .orderBy(desc(syndications.postedAt))
    .limit(1);
  return rows[0]?.postedAt ?? null;
}

export async function recordSuccess(db: Database, slug: string, channel: string, now: Date): Promise<void> {
  await db
    .insert(syndications)
    .values({ slug, channel, postedAt: now, attempts: 1 })
    .onConflictDoUpdate({
      target: [syndications.slug, syndications.channel],
      set: { postedAt: now, attempts: dsql`${syndications.attempts} + 1`, lastError: null },
    });
}

export async function recordFailure(db: Database, slug: string, channel: string, error: string): Promise<void> {
  await db
    .insert(syndications)
    .values({ slug, channel, attempts: 1, lastError: error })
    .onConflictDoUpdate({
      target: [syndications.slug, syndications.channel],
      set: { attempts: dsql`${syndications.attempts} + 1`, lastError: error },
    });
}
