import { PullQuote } from "@/components/shared/pull-quote";
import { linkifyGamertags } from "@/lib/linkify-gamertags";
import type { ArticleBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Shared article body. `blocks` is the R5d rich body; when it is null/absent (every article
 *  written before R5d) — or, since `blocks` arrives as unchecked jsonb, anything else that isn't a
 *  usable array — it falls back to splitting the flat `body` on blank lines — byte-identical
 *  output to the two hand-rolled renderers this replaced. An unrecognised block type is dropped
 *  (`default: return null`) so a newer writer can ship a new kind without breaking an older page.
 *
 *  `roster` is the article's OWN subjects; any gamertag in it that appears in the prose becomes a
 *  link to that player's dossier. Omitted or empty, the rendered DOM is unchanged — which is the
 *  regression guard for the whole pre-linkification corpus. Subheads are deliberately excluded:
 *  they are display type, and an inline red link inside one fights the tabloid look. */
export function ArticleBody({
  blocks,
  fallback,
  className,
  roster = [],
}: {
  blocks?: ArticleBlock[] | null;
  fallback: string;
  className?: string;
  roster?: string[];
}) {
  const wrapper = cn("max-w-[68ch] space-y-4 font-mono text-base leading-relaxed text-ink-soft", className);
  const link = (text: string) => linkifyGamertags(text, roster);

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return (
      <div className={wrapper}>
        {fallback.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{link(para)}</p>
        ))}
      </div>
    );
  }

  return (
    <div className={wrapper}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "para":
            return <p key={i}>{link(block.text)}</p>;
          case "subhead":
            return (
              <h2 key={i} className="pt-2 font-display text-2xl font-bold uppercase leading-tight text-ink">
                {block.text}
              </h2>
            );
          case "quote":
            return <PullQuote key={i} text={link(block.text)} attribution={block.attribution} />;
          case "list":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{link(item)}</li>
                ))}
              </ul>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
