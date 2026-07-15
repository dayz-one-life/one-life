import Link from "next/link";
import type { SurvivorSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { boardHref } from "./links";

const WINDOW = 2;

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - WINDOW);
  const end = Math.min(totalPages, page + WINDOW);
  const pages: number[] = [];
  for (let n = start; n <= end; n++) pages.push(n);
  return pages;
}

export function Pagination({
  slug,
  sort,
  page,
  total,
  pageSize,
}: {
  slug: string | null;
  sort: SurvivorSort;
  page: number;
  total: number;
  pageSize: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPrev = page > 1;
  const showNext = page * pageSize < total;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-2">
      {showPrev && (
        <Link
          href={boardHref(slug, sort, page - 1)}
          className="rounded border border-line bg-panel px-3 py-1 text-sm text-muted hover:text-bone"
        >
          Prev
        </Link>
      )}

      {pageWindow(page, totalPages).map((n) => {
        const active = n === page;
        return (
          <Link
            key={n}
            href={boardHref(slug, sort, n)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded border px-3 py-1 text-sm",
              active
                ? "border-amber/60 bg-amber/10 text-amber"
                : "border-line bg-panel text-muted hover:text-bone"
            )}
          >
            {n}
          </Link>
        );
      })}

      {showNext && (
        <Link
          href={boardHref(slug, sort, page + 1)}
          className="rounded border border-line bg-panel px-3 py-1 text-sm text-muted hover:text-bone"
        >
          Next
        </Link>
      )}
    </nav>
  );
}
