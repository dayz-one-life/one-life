import { cn } from "@/lib/utils";
import { rapSheetFacts } from "@/lib/obituary-format";
import type { ObituaryArticle } from "@/lib/types";

/** The factual Rap Sheet box — deterministic facts, never the LLM. */
export function RapSheet({ article }: { article: ObituaryArticle }) {
  const facts = rapSheetFacts(article);
  const sessions = { label: "Sessions", value: String(article.sessions), hot: false };
  const all = [...facts.slice(0, facts.length - 1), sessions, facts[facts.length - 1]!]; // Cause last
  return (
    <section className="border-2 border-ink bg-bone p-5" aria-labelledby="rap-sheet-heading">
      <h2 id="rap-sheet-heading" className="font-display text-xs font-bold uppercase tracking-[.16em] text-ink">The Rap Sheet · Deceased</h2>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        {all.map((f) => (
          <div key={f.label} className="flex flex-col-reverse">
            <dt className="mt-1 font-mono text-[11px] uppercase tracking-[.07em] text-ink-muted">{f.label}</dt>
            <dd className={cn("font-display text-[26px] font-bold leading-none", f.hot ? "text-red" : "text-ink")}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
