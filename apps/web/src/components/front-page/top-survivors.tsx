import Link from "next/link";
import type { SurvivorRow } from "@/lib/types";
import { SectionHeader } from "@/components/tabloid/section-header";
import { formatTimeAlive } from "@/components/survivors/format";
import { mapLabel } from "@/components/player/format";
import { playerSlug } from "@/lib/slug";

/**
 * Home's board teaser. Since sub-project D there is no combined board, so this is the top of ONE
 * map — the one the shared resolution rule picked for this viewer — and the heading names it so
 * the list is not silently scoped.
 *
 * `slug` is null only when the resolution itself failed; the caller renders that case, not this.
 */
export function TopSurvivors({ rows, slug, map }: { rows: SurvivorRow[]; slug: string; map: string }) {
  return (
    <section className="px-6 py-8 md:px-10">
      <SectionHeader
        title={`Still breathing on ${mapLabel(map)}`}
        action={
          <Link href={`/survivors/${slug}`} className="font-mono text-xs font-bold uppercase tracking-[.06em] text-ink hover:text-red">
            ALL →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.
        </p>
      ) : (
        <ol>
          {rows.map((r, i) => (
            <li key={`${r.gamertag}-${r.slug}`} className="flex items-baseline gap-4 border-b border-hairline py-3">
              <span aria-hidden className="w-8 font-display text-xl font-bold text-red">{i + 1}</span>
              <Link
                href={`/players/${playerSlug(r.gamertag)}`}
                className="font-display text-lg font-bold uppercase text-ink hover:text-red"
              >
                {r.gamertag}
              </Link>
              <span className="ml-auto font-mono text-sm font-bold">{formatTimeAlive(r.timeAliveSeconds)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
