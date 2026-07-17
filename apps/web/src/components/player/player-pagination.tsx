import Link from "next/link";
import { cn } from "@/lib/utils";

const href = (slug: string, page: number) => (page <= 1 ? `/players/${slug}` : `/players/${slug}?page=${page}`);

const box = "flex min-h-[44px] items-center justify-center px-4 font-mono text-[12.5px] uppercase";
const boxLink = "border border-dash text-ink hover:border-ink";
const boxOff = "select-none border border-hairline-2 text-ink-muted opacity-60";

export function PlayerPagination({ slug, page, total, pageSize }: { slug: string; page: number; total: number; pageSize: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Past lives pagination" className="flex flex-wrap items-center justify-center gap-3 border-t-[3px] border-ink pt-3">
      {page > 1 ? (
        <Link href={href(slug, page - 1)} className={cn(box, boxLink)}>
          <span aria-hidden>‹ </span>Newer
        </Link>
      ) : (
        <span aria-hidden className={cn(box, boxOff)}>‹ Newer</span>
      )}
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(slug, page + 1)} className={cn(box, boxLink)}>
          Older<span aria-hidden> ›</span>
        </Link>
      ) : (
        <span aria-hidden className={cn(box, boxOff)}>Older ›</span>
      )}
    </nav>
  );
}
