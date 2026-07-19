import Link from "next/link";
import type { NewsCard } from "@/lib/types";
import { newsArticleHref } from "@/lib/news-format";
import { mapLabel } from "@/components/player/format";

/** Related rail: other recent features. Its rows come from the published feed, which already
 *  excludes retracted articles — a retracted piece must never be recommended. The caller has
 *  already excluded the current article. */
export function MoreFromTheDesk({ rows }: { rows: NewsCard[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10 border-t-[3px] border-ink pt-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em] text-ink">More From the Desk</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.slug}>
            <Link href={newsArticleHref(r.slug)} className="group block">
              <span className="font-display text-lg font-bold uppercase leading-tight text-ink group-hover:text-red">{r.headline}</span>
              <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[.05em] text-ink-muted">{r.gamertag} · {mapLabel(r.map)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
