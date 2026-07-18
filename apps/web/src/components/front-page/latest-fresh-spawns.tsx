import Link from "next/link";
import type { BirthNoticeCard } from "@/lib/types";
import { SectionHeader } from "@/components/tabloid/section-header";
import { birthNoticeHref } from "@/lib/birth-format";
import { mapLabel } from "@/components/player/format";

/** Home-page block: the most recent birth notices (top 3), linking into The Nursery. */
export function LatestFreshSpawns({ rows }: { rows: BirthNoticeCard[] }) {
  return (
    <section className="px-6 py-8 md:px-10">
      <SectionHeader
        title="Just washed ashore"
        action={
          <Link href="/fresh-spawns" className="font-mono text-xs font-bold uppercase tracking-[.06em] text-ink hover:text-blue">
            ALL →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          THE NURSERY IS EMPTY. NO FOOL HAS WASHED ASHORE YET.
        </p>
      ) : (
        <ol>
          {rows.map((r) => (
            <li key={r.slug} className="border-b border-hairline py-3">
              <Link href={birthNoticeHref(r.slug)} className="font-display text-lg font-bold uppercase leading-tight text-ink hover:text-blue">
                {r.headline}
              </Link>
              <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
                {r.gamertag} · {mapLabel(r.map)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
