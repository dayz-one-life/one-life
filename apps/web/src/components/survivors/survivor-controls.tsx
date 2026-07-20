import Link from "next/link";
import type { SurvivorSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { boardHref } from "./links";

const SORT_CHIPS: { sort: SurvivorSort; label: string }[] = [
  { sort: "time", label: "Time alive" },
  { sort: "kills", label: "Kills" },
  { sort: "longest", label: "Longest kill" },
];

export function SurvivorControls({
  slug,
  sort,
  tabs,
}: {
  slug: string | null;
  sort: SurvivorSort;
  tabs: { slug: string | null; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-ink pb-3.5">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = tab.slug === slug;
          return (
            <Link
              key={tab.slug ?? "all"}
              href={boardHref(tab.slug, sort, 1)}
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

      <div className="ml-auto flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11.5px] uppercase tracking-[.05em]">
        {SORT_CHIPS.map((chip) => {
          const active = chip.sort === sort;
          return (
            <Link
              key={chip.sort}
              href={boardHref(slug, chip.sort, 1)}
              aria-current={active ? "page" : undefined}
              className={cn(
                active ? "border-b-2 border-red pb-0.5 font-bold text-red-deep" : "text-ink-muted hover:text-ink"
              )}
            >
              {chip.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
