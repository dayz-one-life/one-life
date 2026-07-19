import type { NewsArticle } from "@/lib/types";
import { newsDossierFacts } from "@/lib/news-format";
import { cn } from "@/lib/utils";

/** The factual strip — read models only, never the LLM. The news analogue of the obituary's Rap
 *  Sheet and the birth notice's Priors box. */
export function NewsDossier({ article }: { article: NewsArticle }) {
  const facts = newsDossierFacts(article);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-hairline py-3">
      {facts.map((f) => (
        <span key={f.label} className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          {f.label} <span className={cn("font-bold", f.hot ? "text-red" : "text-ink")}>{f.value}</span>
        </span>
      ))}
    </div>
  );
}
