import Link from "next/link";
import { cn } from "@/lib/utils";
import { pageBox, pageBoxLink, pageBoxOff } from "@/components/pagination-box";
import { playerPageHref } from "@/lib/player-page-href";

/**
 * In The Paper pagination — owns the `ap` param. `page` here is the CURRENT `ap` value (this
 * section's own page); `otherPage` is the past-lives page (`page` param) that must be
 * preserved when this section's link changes `ap`, so clicking one control never moves the
 * other section too.
 */
export function PaperPagination({
  slug,
  page,
  total,
  pageSize,
  otherPage,
}: {
  slug: string;
  page: number;
  total: number;
  pageSize: number;
  otherPage?: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="In The Paper pagination" className="mt-5 flex flex-wrap items-center justify-center gap-3 border-t-[3px] border-ink pt-3">
      {page > 1 ? (
        <Link href={playerPageHref(slug, { page: otherPage, ap: page - 1 })} className={cn(pageBox, pageBoxLink)}>
          <span aria-hidden>‹ </span>Newer
        </Link>
      ) : (
        <span aria-hidden className={cn(pageBox, pageBoxOff)}>‹ Newer</span>
      )}
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={playerPageHref(slug, { page: otherPage, ap: page + 1 })} className={cn(pageBox, pageBoxLink)}>
          Older<span aria-hidden> ›</span>
        </Link>
      ) : (
        <span aria-hidden className={cn(pageBox, pageBoxOff)}>Older ›</span>
      )}
    </nav>
  );
}
