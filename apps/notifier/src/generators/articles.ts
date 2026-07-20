import { articles, gamertagLinks } from "@onelife/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";

const KIND_MAP: Record<string, { kind: string; title: string; body: string; path: string }> = {
  obituary: {
    kind: "obituary_published",
    title: "You made the Morgue",
    body: "The paper ran your obituary.",
    path: "/obituaries",
  },
  birth_notice: {
    kind: "birth_notice_published",
    title: "You made the Nursery",
    body: "The paper ran your birth notice.",
    path: "/fresh-spawns",
  },
};

/** Articles are keyed by gamertag with whatever casing the log produced, so the join to
 *  the verified owner is case-insensitive. Only published articles notify — a failed or
 *  pending row must never reach a player. */
export const articleGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({
      id: articles.id, kind: articles.kind, slug: articles.slug,
      headline: articles.headline, userId: gamertagLinks.userId,
    })
    .from(articles)
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      sql`lower(${gamertagLinks.gamertag}) = lower(${articles.gamertag})`,
    ))
    .where(and(
      eq(articles.status, "published"),
      inArray(articles.kind, ["obituary", "birth_notice"]),
      gte(articles.generatedAt, from),
    ));

  return rows.flatMap((r): NotificationDraft[] => {
    const meta = KIND_MAP[r.kind];
    if (!meta) return []; // a future article kind is skipped, never crashes the sweep
    return [{
      userId: r.userId,
      kind: meta.kind,
      naturalKey: `article:${r.id}`,
      title: meta.title,
      body: r.headline ?? meta.body,
      href: `${meta.path}/${r.slug}`,
    }];
  });
};
