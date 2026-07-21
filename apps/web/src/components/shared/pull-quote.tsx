import type { ReactNode } from "react";

/** In-voice pull quote — attribution stays anonymous per the voice rules. `text` is a ReactNode,
 *  not a string, so a quote block's prose can carry linkified gamertags. */
export function PullQuote({ text, attribution }: { text: ReactNode; attribution: string }) {
  return (
    <blockquote className="my-6 border-l-[3px] border-red pl-5">
      <p className="font-display text-2xl font-bold uppercase leading-tight text-ink md:text-3xl">“{text}”</p>
      <footer className="mt-2 font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">— {attribution}</footer>
    </blockquote>
  );
}
