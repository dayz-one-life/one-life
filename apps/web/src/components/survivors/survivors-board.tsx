import type { SurvivorsPage } from "@/lib/types";
import { absoluteUrl } from "@/lib/seo";
import { SurvivorControls } from "./survivor-controls";
import { SurvivorRow } from "./survivor-row";
import { Pagination } from "./pagination";
import { boardHref } from "./links";
import { dekLine } from "./format";

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

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd(page, slug)) }}
      />

      <header className="border-b-[3px] border-ink pb-4">
        <h1 className="font-display text-4xl font-bold uppercase leading-[.94] text-ink sm:text-5xl">{heading}</h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[.06em] text-ink-muted">{dekLine(page.total)}</p>
      </header>

      <div className="mt-4">
        <SurvivorControls slug={slug} sort={page.sort} tabs={tabs} />
      </div>

      {page.rows.length === 0 ? (
        <p className="mt-6 bg-tint px-6 py-8 text-center font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          The coast is quiet. No qualified survivors on record.
        </p>
      ) : (
        <ol>
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

      <div className="mt-5">
        <Pagination slug={slug} sort={page.sort} page={page.page} total={page.total} pageSize={page.pageSize} />
      </div>
    </main>
  );
}
