import Link from "next/link";
import { Kicker } from "@/components/tabloid/kicker";
import { CountUp } from "./count-up";
import type { SiteStats } from "@/lib/types";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The cold home's hero. With stats, the casualty ledger IS the `<h1>` — real fleet-wide
 * numbers, the death figure counting up — and the evergreen brand line demotes to the kicker.
 * Without stats (fetch failed / null), the evergreen hero renders unchanged: the floor is a
 * fully legitimate front page, so there is no banner and NEVER a zero (live-data honesty).
 *
 * The visible ledger is aria-hidden with an sr-only sentence carrying the final numbers, so a
 * screen reader hears one clean announcement rather than CountUp's ticking digits.
 */
export function Hero({ stats }: { stats?: SiteStats | null }) {
  return (
    <section className="border-b-[3px] border-ink px-6 py-10 md:px-10 md:py-14">
      <Kicker>{stats ? "One life. No respawns." : "The record of record"}</Kicker>
      {stats ? (
        <h1 className="mt-3 font-display text-4xl font-bold uppercase leading-[1.05] md:text-6xl">
          <span className="sr-only">
            {`Deaths to date: ${fmt(stats.deaths)}. Still standing: ${fmt(stats.alive)}.`}
          </span>
          <span aria-hidden="true">
            Deaths to date: <span className="text-red"><CountUp value={stats.deaths} /></span>.{" "}
            Still standing: {fmt(stats.alive)}.
          </span>
        </h1>
      ) : (
        <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[.95] md:text-7xl">
          One life. No respawns.
        </h1>
      )}
      <p className="mt-5 max-w-3xl font-sans text-lg leading-relaxed text-ink-soft">
        Hardcore permadeath DayZ, tracked to the minute. One life per server; when it ends, the
        ban is real and the record is permanent. The living are ranked below.
      </p>
      <Link
        href="/about"
        className="mt-6 inline-block border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
      >
        How it works →
      </Link>
    </section>
  );
}
