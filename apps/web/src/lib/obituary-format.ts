import { mapLabel, formatDuration, relativeDate } from "@/components/player/format";
import { verdictPhrase } from "./cause-format";
import type { ObituaryCard, DeathVerdictDto } from "./types";

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

export type RapFact = { label: string; value: string; hot: boolean };

/** The factual Rap Sheet — never the LLM. Cause is the red (hot) stat. */
export function rapSheetFacts(
  a: Pick<ObituaryCard, "timeAliveSeconds" | "kills" | "longestKillMeters" | "cause"> & { verdict?: DeathVerdictDto | null },
): RapFact[] {
  const out: RapFact[] = [
    { label: "Survived", value: formatDuration(a.timeAliveSeconds), hot: false },
    { label: "Kills", value: String(a.kills), hot: false },
  ];
  if (a.longestKillMeters != null) out.push({ label: "Longest kill", value: `${Math.round(a.longestKillMeters)}m`, hot: false });
  out.push({ label: "Cause", value: verdictPhrase(a.verdict ?? null, a.cause), hot: true });
  return out;
}

export function obituaryShowingLine(page: number, pageSize: number, total: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} filed`;
}
