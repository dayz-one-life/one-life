import { mapLabel, formatDuration, relativeDate } from "@/components/player/format";
import { verdictPhrase } from "./cause-format";
import type { ArticleDeathDto, ObituaryCard, LegacyVerdictDto } from "./types";

export function obituariesHref(page: number): string {
  return page > 1 ? `/obituaries?page=${page}` : "/obituaries";
}

export function obituaryHref(slug: string): string {
  return `/obituaries/${slug}`;
}

/** "CHERNARUS BUREAU · 2 days ago" */
export function dateline(map: string, deathAtIso: string, now: Date): string {
  return `${mapLabel(map).toUpperCase()} BUREAU · ${relativeDate(deathAtIso, now)}`;
}

/** `caption` is set on the Cause fact only when the article carries a death (live or frozen): the
 *  hedge line under a strong or inferred cause, or the credit caption under a trap kill. */
export type RapFact = { label: string; value: string; hot: boolean; caption?: string | null };

/**
 * The factual Rap Sheet — never the LLM. Cause is the red (hot) stat.
 *
 * The cause is the article's `death` label when it has one (the live final verdict, else the
 * strings frozen when it was written; the read-model never hands over a pending one), else the
 * legacy wording from the frozen `verdict` and `cause` — what an article written before stage 4
 * has (death-verdict spec 6.2).
 */
export function rapSheetFacts(
  a: Pick<ObituaryCard, "timeAliveSeconds" | "kills" | "longestKillMeters" | "cause"> & { verdict?: LegacyVerdictDto | null; death?: ArticleDeathDto | null },
): RapFact[] {
  const out: RapFact[] = [
    { label: "Survived", value: formatDuration(a.timeAliveSeconds), hot: false },
    { label: "Kills", value: String(a.kills), hot: false },
  ];
  if (a.longestKillMeters != null) out.push({ label: "Longest kill", value: `${Math.round(a.longestKillMeters)}m`, hot: false });
  const death = a.death?.label ? a.death : null;
  out.push({
    label: "Cause", value: death ? death.label : verdictPhrase(a.verdict ?? null, a.cause), hot: true,
    ...(death ? { caption: death.caption } : {}),
  });
  return out;
}

export function obituaryShowingLine(page: number, pageSize: number, total: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} filed`;
}

/** OG-card headline size: stepped, not fluid — satori has no clamp()/container queries. */
export function obituaryHeadlineSize(headline: string): number {
  return headline.length <= 45 ? 76 : headline.length <= 75 ? 62 : 52;
}
