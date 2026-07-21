import Link from "next/link";
import { cn } from "@/lib/utils";
import { pageBox, pageBoxLink, pageBoxOff } from "@/components/pagination-box";
import { playerPageHref } from "@/lib/player-page-href";

/**
 * Past-lives pagination. `ap` is the OTHER pagination on this page (In The Paper) — it must be
 * preserved when a past-lives link changes `page`, or clicking one control would silently move
 * both sections. Omitted (undefined), it simply isn't added to the URL.
 */
export function PlayerPagination({ slug, page, total, pageSize, ap }: { slug: string; page: number; total: number; pageSize: number; ap?: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Past lives pagination" className="flex flex-wrap items-center justify-center gap-3 border-t-[3px] border-ink pt-3">
      {page > 1 ? (
        <Link href={playerPageHref(slug, { page: page - 1, ap })} className={cn(pageBox, pageBoxLink)}>
          <span aria-hidden>‹ </span>Newer
        </Link>
      ) : (
        <span aria-hidden className={cn(pageBox, pageBoxOff)}>‹ Newer</span>
      )}
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={playerPageHref(slug, { page: page + 1, ap })} className={cn(pageBox, pageBoxLink)}>
          Older<span aria-hidden> ›</span>
        </Link>
      ) : (
        <span aria-hidden className={cn(pageBox, pageBoxOff)}>Older ›</span>
      )}
    </nav>
  );
}
