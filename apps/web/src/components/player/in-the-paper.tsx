import Link from "next/link";
import type { PlayerArticleRow } from "@/lib/types";
import { monthYear, mapLabel } from "./format";

/**
 * Routes an article's `kind` to its published interior. An unknown kind must never produce a
 * broken href — the caller falls back to rendering the headline as plain text instead of
 * linking somewhere that 404s.
 */
export function articleHref(kind: string, slug: string): string | null {
  switch (kind) {
    case "obituary":
      return `/obituaries/${slug}`;
    case "birth_notice":
      return `/fresh-spawns/${slug}`;
    case "news":
      return `/news/${slug}`;
    default:
      return null;
  }
}

const KIND_LABEL: Record<string, string> = {
  obituary: "Obituary",
  birth_notice: "Birth Notice",
  news: "News",
};

type InThePaperProps = {
  slug: string;
  rows: PlayerArticleRow[];
  total: number;
  page: number;
  pageSize: number;
  /** A REJECTED fetch, distinct from a genuinely empty feed — loading/error must never render
   *  as the authoritative "the paper never wrote about this player." Pagination for this
   *  section lives in a sibling component (it needs the OTHER param, `page`, to preserve it —
   *  see `PaperPagination`); `total`/`page`/`pageSize` are accepted here only to keep this
   *  component's props shaped like the feed it renders. */
  failed: boolean;
};

export function InThePaper({ slug, rows, failed }: InThePaperProps) {
  if (!failed && rows.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-bold uppercase tracking-[.1em] text-ink">In The Paper</h2>

      {failed ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 border border-hairline bg-bone px-4 py-3 font-mono text-[11px] uppercase tracking-[.05em] text-red-deep"
        >
          Couldn&apos;t load {slug}&apos;s press coverage — try again shortly.
        </p>
      ) : (
        <ul role="list" className="m-0 mt-3 grid list-none gap-4 p-0">
          {rows.map((row) => {
            const href = articleHref(row.kind, row.slug);
            return (
              <li key={`${row.kind}:${row.slug}`} className="border border-hairline border-t-4 border-t-ink bg-paper px-5 py-4">
                <p className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[.04em] text-ink-muted">
                  <span>{KIND_LABEL[row.kind] ?? row.kind}</span>
                  {row.mapSlug && <span>· {mapLabel(row.mapSlug)}</span>}
                  <span>· {monthYear(row.createdAt)}</span>
                  {row.role === "killer" && (
                    <span className="border border-red-deep px-1.5 py-0.5 text-red-deep">As killer</span>
                  )}
                </p>
                <h3 className="mt-1 font-display text-[17px] font-bold uppercase text-ink">
                  {href ? (
                    <Link href={href} className="hover:text-red">
                      {row.headline}
                    </Link>
                  ) : (
                    row.headline
                  )}
                </h3>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
