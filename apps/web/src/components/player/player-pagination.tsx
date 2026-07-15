import Link from "next/link";
import { cn } from "@/lib/utils";

const href = (slug: string, page: number) => (page <= 1 ? `/players/${slug}` : `/players/${slug}?page=${page}`);

export function PlayerPagination({ slug, page, total, pageSize }: { slug: string; page: number; total: number; pageSize: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const base = "rounded-lg border border-line bg-panel px-4 py-2 text-muted hover:text-bone";
  const off = "pointer-events-none opacity-30";
  return (
    <nav aria-label="Past lives pagination" className="flex items-center justify-center gap-4 pt-2 text-sm">
      <Link href={href(slug, page - 1)} aria-disabled={page <= 1} className={cn(base, page <= 1 && off)}>‹ Newer</Link>
      <span className="text-muted">Page {page} of {totalPages}</span>
      <Link href={href(slug, page + 1)} aria-disabled={page >= totalPages} className={cn(base, page >= totalPages && off)}>Older ›</Link>
    </nav>
  );
}
