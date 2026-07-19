import { mapLabel, formatDuration, relativeDate } from "@/components/player/format";
import type { NewsArticle, NewsTrigger } from "./types";

export function newsHref(page: number): string {
  return page > 1 ? `/news?page=${page}` : "/news";
}

export function newsArticleHref(slug: string): string {
  return `/news/${slug}`;
}

/** "CHERNARUS BUREAU · 2 days ago" — keyed on created_at, because a Standing Dead feature has no
 *  death to date from. Map only, never a coordinate (Fog Rule §4.1.4). */
export function newsDateline(map: string, createdAtIso: string, now: Date): string {
  return `${mapLabel(map).toUpperCase()} BUREAU · ${relativeDate(createdAtIso, now)}`;
}

/**
 * ARGUMENT ORDER IS (page, total, pageSize) — the birthShowingLine order, per spec §9.
 * obituaryShowingLine is (page, pageSize, total). Every parameter is a `number`, so calling this
 * in the obituary order compiles and renders a plausible-but-wrong total. Pinned by a test.
 */
export function newsShowingLine(page: number, total: number, pageSize: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} filed`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "14 JUL 2026", in UTC. Deliberately NOT toLocaleDateString, whose output depends on the
 *  runtime's ICU data and would differ between the server render and a test. Mirrors the UTC
 *  discipline of `monthYear` in components/player/format.ts. */
export function newsUpdateDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const TRIGGER_LABEL: Record<NewsTrigger, string> = {
  standing_dead: "The Standing Dead",
  long_form: "The Long Form",
};

/** A guarded Record, not a ternary: a binary ternary on a widening union is exactly the defect
 *  spec §7 catalogues in the image pass. A fourth trigger must fail loudly here. */
export function triggerLabel(trigger: NewsTrigger): string {
  const label = TRIGGER_LABEL[trigger];
  if (!label) throw new Error(`unknown news trigger: ${trigger}`);
  return label;
}

export type NewsFact = { label: string; value: string; hot: boolean };

/**
 * The factual dossier strip — read-model figures only, never the LLM.
 *
 * "Played" is `time_alive_seconds` (playtime), never wall clock (§11). "Idle" is a SEPARATE row
 * with its own label, because it is the length of an absence and must never read as endurance.
 * "Span" is seconds between the first and last death — a TIME, never a distance: the distance
 * that made the cluster a cluster never leaves the newsdesk.
 */
export function newsDossierFacts(a: NewsArticle): NewsFact[] {
  const out: NewsFact[] = [
    { label: "Played", value: formatDuration(a.timeAliveSeconds), hot: false },
    { label: "Kills", value: String(a.kills), hot: false },
    { label: "Life", value: `${a.lifeNumber} · ${mapLabel(a.map)}`, hot: false },
  ];
  if (a.trigger === "standing_dead") {
    if (a.idleSeconds != null) {
      const days = Math.floor(a.idleSeconds / 86_400);
      out.push({ label: "Idle", value: `${days} day${days === 1 ? "" : "s"}`, hot: true });
    }
  } else {
    out.push({ label: "Subjects", value: String(a.subjectCount), hot: true });
    if (a.spanSeconds != null) out.push({ label: "Span", value: `${a.spanSeconds}s`, hot: false });
  }
  return out;
}
