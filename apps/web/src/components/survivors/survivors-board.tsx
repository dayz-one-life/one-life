import type { SurvivorsPage } from "@/lib/types";
import { absoluteUrl } from "@/lib/seo";
import { SurvivorControls } from "./survivor-controls";
import { SurvivorRow } from "./survivor-row";
import { Pagination } from "./pagination";
import { boardHref } from "./links";

const SCOPE_LABEL: Record<string, string> = {
  chernarus: "Chernarus",
  sakhal: "Sakhal",
};

function mapLabel(slug: string): string {
  return SCOPE_LABEL[slug] ?? slug.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Minimal schema.org ItemList over the visible survivors, for SEO. */
function itemListLd(page: SurvivorsPage, slug: string | null) {
  const startRank = (page.page - 1) * page.pageSize;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    url: absoluteUrl(boardHref(slug, page.sort, page.page)),
    numberOfItems: page.total,
    itemListElement: page.rows.map((row, i) => ({
      "@type": "ListItem",
      position: startRank + i + 1,
      name: row.gamertag,
    })),
  };
}

export function SurvivorsBoard({
  page,
  slug,
  tabs,
}: {
  page: SurvivorsPage;
  slug: string | null;
  tabs: { slug: string | null; label: string }[];
}) {
  const heading = slug ? `${mapLabel(slug)} survivors` : "Survivors";
  const aliveCount = page.total;
  const subtitle =
    aliveCount === 1 ? "1 survivor still drawing breath" : `${aliveCount} survivors still drawing breath`;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd(page, slug)) }}
      />

      <header className="space-y-1">
        <h1 className="font-display text-3xl text-amber">{heading}</h1>
        <p className="text-sm text-muted">{subtitle}</p>
      </header>

      <SurvivorControls slug={slug} sort={page.sort} tabs={tabs} />

      {page.rows.length === 0 ? (
        <p className="rounded border border-line bg-panel p-6 text-center text-muted">
          No survivors alive right now.
        </p>
      ) : (
        <ol className="space-y-2">
          {page.rows.map((row, i) => (
            <li key={`${row.gamertag}:${row.slug}`}>
              <SurvivorRow
                row={row}
                rank={(page.page - 1) * page.pageSize + i + 1}
                showMap={slug === null}
                sort={page.sort}
              />
            </li>
          ))}
        </ol>
      )}

      <Pagination slug={slug} sort={page.sort} page={page.page} total={page.total} pageSize={page.pageSize} />
    </main>
  );
}
