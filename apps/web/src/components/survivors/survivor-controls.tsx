import Link from "next/link";
import type { SurvivorSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { boardHref } from "./links";

const SORT_CHIPS: { sort: SurvivorSort; label: string }[] = [
  { sort: "kills", label: "Kills" },
  { sort: "time", label: "Time alive" },
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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = tab.slug === slug;
          return (
            <Link
              key={tab.slug ?? "all"}
              href={boardHref(tab.slug, sort, 1)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded border px-3 py-1 text-sm",
                active
                  ? "border-amber/60 bg-amber/10 text-amber"
                  : "border-line bg-panel text-muted hover:text-bone"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {SORT_CHIPS.map((chip) => {
          const active = chip.sort === sort;
          return (
            <Link
              key={chip.sort}
              href={boardHref(slug, chip.sort, 1)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs uppercase tracking-wide",
                active
                  ? "border-amber/60 bg-amber/10 text-amber"
                  : "border-line bg-panel-2 text-muted hover:text-bone"
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
