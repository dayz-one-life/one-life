import Link from "next/link";
import { cn } from "@/lib/utils";
import { pageBox, pageBoxLink, pageBoxOff } from "@/components/pagination-box";
import { obituariesHref, obituaryShowingLine } from "@/lib/obituary-format";

const WINDOW = 2;

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - WINDOW);
  const end = Math.min(totalPages, page + WINDOW);
  const pages: number[] = [];
  for (let n = start; n <= end; n++) pages.push(n);
  return pages;
}

export function ObituariesPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPrev = page > 1;
  const showNext = page * pageSize < total;
  return (
    <nav aria-label="Pagination" className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t-[3px] border-ink pt-3">
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">{obituaryShowingLine(page, pageSize, total)}</span>
      <div className="flex flex-wrap gap-2">
        {showPrev ? (
          <Link href={obituariesHref(page - 1)} className={cn(pageBox, pageBoxLink)}><span aria-hidden>← </span>Prev</Link>
        ) : (
          <span aria-hidden className={cn(pageBox, pageBoxOff)}>← Prev</span>
        )}
        {pageWindow(page, totalPages).map((n) =>
          n === page ? (
            <span key={n} aria-current="page" className={cn(pageBox, "bg-ink text-paper")}>{n}</span>
          ) : (
            <Link key={n} href={obituariesHref(n)} className={cn(pageBox, pageBoxLink)}>{n}</Link>
          ),
        )}
        {showNext ? (
          <Link href={obituariesHref(page + 1)} className={cn(pageBox, pageBoxLink)}>Next<span aria-hidden> →</span></Link>
        ) : (
          <span aria-hidden className={cn(pageBox, pageBoxOff)}>Next →</span>
        )}
      </div>
    </nav>
  );
}
