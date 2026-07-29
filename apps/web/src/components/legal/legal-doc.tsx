import type { ReactNode } from "react";
import { Kicker } from "@/components/tabloid/kicker";

/** One clause of a legal document. `id` is a stable anchor — see the test for why it matters. */
export interface LegalSection {
  id: string;
  heading: string;
  body: ReactNode;
}

export interface LegalDocProps {
  kicker: string;
  title: string;
  standfirst: string;
  effectiveDate: string;
  sections: LegalSection[];
}

/**
 * Presentation only — this component holds no copy of its own. Both legal pages render through
 * it so they cannot drift apart typographically, which is the whole reason the content lives in
 * data modules rather than in two hand-written pages.
 *
 * `max-w-3xl`, narrower than /about's `max-w-5xl`: this is one column of continuous prose, and a
 * 5xl measure is unreadable for it.
 */
export function LegalDoc({ kicker, title, standfirst, effectiveDate, sections }: LegalDocProps) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-14">
      <header className="border-b-[3px] border-ink pb-8">
        <Kicker>{kicker}</Kicker>
        <h1 className="mt-3 font-display text-4xl font-bold uppercase leading-[.9] md:text-6xl">
          {title}
        </h1>
        <p className="mt-5 font-sans text-lg leading-relaxed text-ink-soft">{standfirst}</p>
        <p className="mt-5 font-mono text-xs uppercase tracking-[.06em] text-ink-muted">
          Last updated {effectiveDate}
        </p>
      </header>

      {sections.map((s) => (
        // scroll-mt-24 clears the sticky masthead when someone follows a #clause link.
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`} className="mt-10 scroll-mt-24">
          <h2
            id={`${s.id}-heading`}
            className="border-b-[3px] border-ink pb-2 font-display text-2xl font-bold uppercase"
          >
            {s.heading}
          </h2>
          <div className="mt-4 space-y-4 font-sans text-base leading-relaxed text-ink-soft">
            {s.body}
          </div>
        </section>
      ))}
    </main>
  );
}
