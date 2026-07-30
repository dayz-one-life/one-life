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
  /** Rendered inside `<main>`, after the sections — e.g. a cross-link to the sibling legal page.
   *  Keeps it inside the page's one landmark rather than orphaned as a sibling of `<main>`. */
  children?: ReactNode;
}

/**
 * Presentation only — this component holds no copy of its own. Both legal pages render through
 * it so they cannot drift apart typographically, which is the whole reason the content lives in
 * data modules rather than in two hand-written pages.
 *
 * `max-w-3xl`, narrower than the 1024px content box every page now sits in
 * (`app/(site)/(boxed)/layout.tsx`): this is one column of continuous prose, and a 1024px measure
 * is unreadable for it. One of the two prose exceptions to the box owning every width — the other
 * is `obituaries/obituary-article.tsx`.
 */
export function LegalDoc({ kicker, title, standfirst, effectiveDate, sections, children }: LegalDocProps) {
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
        // scroll-mt-24 is a reserved offset for a #clause link, in case the masthead
        // (apps/web/src/components/shell/header.tsx, currently `relative z-40`, not sticky) ever
        // becomes sticky. Harmless today either way.
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

      {children}
    </main>
  );
}
