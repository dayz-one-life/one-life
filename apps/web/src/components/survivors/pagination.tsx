import Link from "next/link";
import type { SurvivorSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { boardHref } from "./links";
import { showingLine } from "./format";

const WINDOW = 2;

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - WINDOW);
  const end = Math.min(totalPages, page + WINDOW);
  const pages: number[] = [];
  for (let n = start; n <= end; n++) pages.push(n);
  return pages;
}

const box = "flex min-h-[44px] min-w-[44px] items-center justify-center px-3 font-mono text-[12.5px] uppercase";
const boxLink = "border border-dash text-ink hover:border-ink";
const boxOff = "select-none border border-hairline-2 text-ink-muted opacity-60";

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
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPrev = page > 1;
  const showNext = page * pageSize < total;

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t-[3px] border-ink pt-3">
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
        {showingLine(page, pageSize, total)}
      </span>
      <div className="flex flex-wrap gap-2">
        {showPrev ? (
          <Link href={boardHref(slug, sort, page - 1)} className={cn(box, boxLink)}>
            <span aria-hidden>← </span>Prev
          </Link>
        ) : (
          <span aria-hidden className={cn(box, boxOff)}>← Prev</span>
        )}

        {pageWindow(page, totalPages).map((n) => {
          const active = n === page;
          if (active) {
            return (
              <span key={n} aria-current="page" className={cn(box, "bg-ink text-paper")}>
                {n}
              </span>
            );
          }
          return (
            <Link key={n} href={boardHref(slug, sort, n)} className={cn(box, boxLink)}>
              {n}
            </Link>
          );
        })}

        {showNext ? (
          <Link href={boardHref(slug, sort, page + 1)} className={cn(box, boxLink)}>
            Next<span aria-hidden> →</span>
          </Link>
        ) : (
          <span aria-hidden className={cn(box, boxOff)}>Next →</span>
        )}
      </div>
    </nav>
  );
}
