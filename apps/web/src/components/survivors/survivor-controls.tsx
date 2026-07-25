import Link from "next/link";
import { cn } from "@/lib/utils";
import { boardHref } from "./links";

/**
 * The board's map tabs.
 *
 * ⚠️ The sort pills are gone with the rest of the sort layer (sub-project D), and so is the
 * "All maps" tab — a life is per-server, so there is nothing to combine. This is now purely a
 * map switcher, and every tab is a real slug.
 */
export function SurvivorControls({
  slug,
  tabs,
}: {
  slug: string;
  tabs: { slug: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-ink pb-3.5">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = tab.slug === slug;
          return (
            <Link
              key={tab.slug}
              href={boardHref(tab.slug, 1)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-skew-x-[5deg] px-3 pb-0.5 pt-1 font-display text-xs font-semibold uppercase tracking-[.09em]",
                active ? "bg-ink text-paper" : "border border-ink text-ink hover:bg-ink hover:text-paper"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
