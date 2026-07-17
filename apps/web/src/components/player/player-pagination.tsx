import Link from "next/link";
import { cn } from "@/lib/utils";
import { pageBox, pageBoxLink, pageBoxOff } from "@/components/pagination-box";

const href = (slug: string, page: number) => (page <= 1 ? `/players/${slug}` : `/players/${slug}?page=${page}`);

export function PlayerPagination({ slug, page, total, pageSize }: { slug: string; page: number; total: number; pageSize: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Past lives pagination" className="flex flex-wrap items-center justify-center gap-3 border-t-[3px] border-ink pt-3">
      {page > 1 ? (
        <Link href={href(slug, page - 1)} className={cn(pageBox, pageBoxLink)}>
          <span aria-hidden>‹ </span>Newer
        </Link>
      ) : (
        <span aria-hidden className={cn(pageBox, pageBoxOff)}>‹ Newer</span>
      )}
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(slug, page + 1)} className={cn(pageBox, pageBoxLink)}>
          Older<span aria-hidden> ›</span>
        </Link>
      ) : (
        <span aria-hidden className={cn(pageBox, pageBoxOff)}>Older ›</span>
      )}
    </nav>
  );
}
