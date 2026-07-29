import Link from "next/link";
import { CountUp } from "./count-up";
import { FitLine } from "./fit-line";
import type { SiteStats } from "@/lib/types";

const fmt = (n: number) => n.toLocaleString("en-US");

/** The primary CTA — also reused by the CTA slab (Task 4) so the two asks cannot drift. */
export function ClaimCta({ large = false, fill = false, href = "/login", label = "Claim your life →" }: {
  large?: boolean; fill?: boolean; href?: string; label?: string;
}) {
  const size = fill
    ? "flex h-full w-full items-center justify-center px-10 py-6 text-xl md:text-2xl"
    : large ? "inline-block px-10 py-4 text-lg" : "inline-block px-7 py-3.5 text-base";
  return (
    <Link
      href={href}
      // red-deep as a BACKGROUND under white text on dark: deliberate (contrast improves on
      // hover) — not a light-surface-token violation; do not "fix" in a RED-POLICY sweep.
      className={`-skew-x-[5deg] bg-red text-white font-display font-bold uppercase tracking-[.08em] hover:bg-red-deep ${size}`}
    >
      {label}
    </Link>
  );
}

/**
 * The cold home's hero — beat 1 of the relaunch (cold-home-relaunch spec §2): dark full-bleed,
 * two-line ledger, NO trailing periods, CTA in the hero. Without stats the same dark stage
 * carries the evergreen brand line as the h1 — never a zero, no banner (live-data honesty).
 * The sr-only sentence stays the h1's accessible name; every visible ledger span is aria-hidden
 * (CountUp's ticking digits must not reach a screen reader).
 */
export function Hero({ stats }: { stats?: SiteStats | null }) {
  return (
    <section className="border-b-[6px] border-red bg-dark px-6 py-12 text-paper md:px-10 md:py-16">
      <p className="font-mono text-xs uppercase tracking-[.28em] text-cream-dim">
        {stats ? (
          <>
            <span className="font-bold text-red">One life. No respawns</span> — hardcore permadeath DayZ · Xbox
          </>
        ) : (
          "The record of record"
        )}
      </p>
      {stats ? (
        <h1 className="mt-4 font-display font-bold uppercase leading-[.95]">
          {/* Split across sibling spans so no single node's OWN text run is the literal phrase
           *  "Still standing:" — that string also appears, verbatim, on the visible (aria-hidden)
           *  line below, and `getNodeText` (what `getByText` matches against) only looks at a
           *  node's direct text-node children, not its full subtree. A single flat text node here
           *  would collide with the visible line and make `getByText(/Still standing:/i)`
           *  ambiguous. The accessible-name algorithm, unlike `getNodeText`, concatenates the
           *  whole subtree, so splitting it this way still yields the exact same h1 name. */}
          <span className="sr-only">
            <span>{`Deaths to date: ${fmt(stats.deaths)}.`}</span> <span>Still</span>{" "}
            <span>{`standing: ${fmt(stats.alive)}`}</span>
          </span>
          <span aria-hidden="true" className="block">
            <FitLine
              finalText={`Deaths to date: ${fmt(stats.deaths)}`}
              className="relative tabular-nums"
              lineClassName="text-[clamp(2.5rem,9vw,10rem)]"
            >
              Deaths to date: <span className="text-red"><CountUp value={stats.deaths} /></span>
            </FitLine>
            <span className="mt-3 block font-semibold tracking-[.12em] text-cream-dim text-2xl md:text-4xl">
              Still standing: <span className="text-paper tabular-nums">{fmt(stats.alive)}</span>
            </span>
          </span>
        </h1>
      ) : (
        <h1 className="mt-4 font-display text-5xl font-bold uppercase leading-[.95] md:text-7xl">
          One life. No respawns
        </h1>
      )}
      <div data-testid="hero-cta-row" className="mt-6 grid gap-6 md:grid-cols-2 md:items-stretch">
        <p className="max-w-xl font-sans text-lg leading-relaxed text-cream-dim">
          Every life on our servers is tracked to the minute — birth to death, across sessions.
          When you die, the ban is real and the record is permanent.
        </p>
        <div className="min-h-[72px]">
          <ClaimCta fill />
        </div>
      </div>
    </section>
  );
}
