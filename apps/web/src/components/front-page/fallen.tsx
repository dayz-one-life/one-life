import Link from "next/link";
import type { ObituaryCard } from "@/lib/types";
import { mapLabel, formatDuration } from "@/components/player/format";

/**
 * Beat 2 — the obituary wall (cold-home-relaunch spec §2). Proof that deaths here are events
 * with an audience. ⚠️ Empty rows (failed fetch OR genuinely no obituaries) render NOTHING —
 * a pitch page never shows an empty morgue or an error card; absent proof is silence.
 */
export function Fallen({ rows }: { rows: ObituaryCard[] }) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, 3);
  return (
    <section aria-label="Recent obituaries" className="px-6 py-9 md:px-10">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-bold uppercase">
          The <span className="text-red">Fallen</span>
        </h2>
        <Link href="/obituaries" className="font-mono text-[11px] uppercase tracking-[.08em] text-ink-muted hover:text-red">
          All obituaries →
        </Link>
      </div>
      <ul role="list" className="mt-5 grid gap-4 md:grid-cols-3">
        {shown.map((o) => (
          <li key={o.slug} className="relative border border-hairline border-t-[3px] border-t-ink bg-white">
            <Link href={`/obituaries/${o.slug}`} className="block p-4">
              <p className="font-mono text-[10px] uppercase tracking-[.12em] text-red-deep">
                Obituary · {mapLabel(o.map)}
              </p>
              <h3 className="mt-2 font-display text-lg font-semibold leading-snug">{o.headline}</h3>
              <p
                className="mt-2 overflow-hidden font-sans text-sm italic leading-relaxed text-ink-soft"
                style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
              >
                {o.lede}
              </p>
              <p className="mt-3 flex justify-between border-t border-hairline pt-2.5 font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
                <span>{o.gamertag}</span>
                <span>{formatDuration(o.timeAliveSeconds)} survived</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
