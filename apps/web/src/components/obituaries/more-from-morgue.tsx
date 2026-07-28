import Link from "next/link";
import type { ObituaryCard } from "@/lib/types";
import { obituaryHref } from "@/lib/obituary-format";
import { mapLabel } from "@/components/player/format";

/** Related-rail: other recent obituaries (self already excluded by the caller). */
export function MoreFromMorgue({ rows }: { rows: ObituaryCard[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10 border-t-[3px] border-ink pt-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em] text-ink">More From the Morgue</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.slug}>
            <Link href={obituaryHref(r.slug)} className="group block">
              <span className="font-display text-lg font-bold uppercase leading-tight text-ink group-hover:text-red">{r.headline}</span>
              <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[.05em] text-ink-muted">{r.gamertag} · {mapLabel(r.map)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
