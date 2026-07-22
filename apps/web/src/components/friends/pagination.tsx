import { cn } from "@/lib/utils";
import { pageBox, pageBoxLink, pageBoxOff } from "@/components/pagination-box";

const WINDOW = 2;

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - WINDOW);
  const end = Math.min(totalPages, page + WINDOW);
  const pages: number[] = [];
  for (let n = start; n <= end; n++) pages.push(n);
  return pages;
}

export function friendsShowingLine(page: number, pageSize: number, total: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} friends`;
}

/**
 * Paginator for the Friends section only — `incoming`/`outgoing` are returned whole by the
 * read model and must never gain a pager. Same mono box idiom (disabled edges, windowed page
 * numbers, clamped "showing X-Y of Z" line) as the survivors board's `Pagination` and the
 * player dossier's `PlayerPagination`, but driven by a callback instead of a `Link` — the
 * roster is a private, noindex, client-only page with no shareable page URL.
 */
export function FriendsPagination({
  page, total, pageSize, onPage,
}: {
  page: number; total: number; pageSize: number; onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const showPrev = page > 1;
  const showNext = page * pageSize < total;

  return (
    <nav aria-label="Friends pagination" className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
        {friendsShowingLine(page, pageSize, total)}
      </span>
      <div className="flex flex-wrap gap-2">
        {showPrev ? (
          <button type="button" onClick={() => onPage(page - 1)} className={cn(pageBox, pageBoxLink)}>
            <span aria-hidden>← </span>Prev
          </button>
        ) : (
          <span aria-hidden className={cn(pageBox, pageBoxOff)}>← Prev</span>
        )}

        {pageWindow(page, totalPages).map((n) => {
          const active = n === page;
          if (active) {
            return (
              <span key={n} aria-current="page" className={cn(pageBox, "bg-ink text-paper")}>
                {n}
              </span>
            );
          }
          return (
            <button key={n} type="button" onClick={() => onPage(n)} className={cn(pageBox, pageBoxLink)}>
              {n}
            </button>
          );
        })}

        {showNext ? (
          <button type="button" onClick={() => onPage(page + 1)} className={cn(pageBox, pageBoxLink)}>
            Next<span aria-hidden> →</span>
          </button>
        ) : (
          <span aria-hidden className={cn(pageBox, pageBoxOff)}>Next →</span>
        )}
      </div>
    </nav>
  );
}
