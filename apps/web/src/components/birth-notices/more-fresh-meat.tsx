import Link from "next/link";
import type { BirthNoticeCard } from "@/lib/types";
import { birthNoticeHref } from "@/lib/birth-format";
import { mapLabel } from "@/components/player/format";

/** Related-rail: other recent birth notices (self already excluded by the caller). */
export function MoreFreshMeat({ rows }: { rows: BirthNoticeCard[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10 border-t-[3px] border-ink pt-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em] text-ink">More Fresh Meat</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.slug}>
            <Link href={birthNoticeHref(r.slug)} className="group block">
              <span className="font-display text-lg font-bold uppercase leading-tight text-ink group-hover:text-blue">{r.headline}</span>
              <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[.05em] text-ink-muted">{r.gamertag} · {mapLabel(r.map)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
