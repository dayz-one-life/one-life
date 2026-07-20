import { cn } from "@/lib/utils";
import { priorsFacts } from "@/lib/birth-format";
import { monthYear } from "@/components/player/format";
import type { BirthNoticeArticle } from "@/lib/types";

/** The deterministic "Priors" box — the player's global record, never the LLM. */
export function PriorsBox({ article }: { article: BirthNoticeArticle }) {
  const facts = priorsFacts(article);
  return (
    <section className="border-2 border-ink bg-bone p-5">
      <p className="font-display text-xs font-bold uppercase tracking-[.16em] text-ink">The Priors</p>
      {facts.length === 0 ? (
        <p className="mt-3 font-mono text-[13px] leading-relaxed text-ink-soft">No priors. A stranger to these shores.</p>
      ) : (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
          {facts.map((f) => (
            <div key={f.label}>
              <dd className={cn("font-display text-[26px] font-bold leading-none", f.hot ? "text-red" : "text-ink")}>{f.value}</dd>
              <dt className="mt-1 font-mono text-[11px] uppercase tracking-[.07em] text-ink-muted">{f.label}</dt>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
        Washed ashore {monthYear(article.bornAt)}
        {article.minutesToQualify != null ? ` · qualified in ${article.minutesToQualify} min` : ""}
      </p>
    </section>
  );
}
