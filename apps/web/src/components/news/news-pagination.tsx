import { NumberedPager } from "@/components/shared/numbered-pager";
import { newsHref, newsShowingLine } from "@/lib/news-format";

export function NewsPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  return (
    <NumberedPager
      page={page}
      total={total}
      pageSize={pageSize}
      hrefFor={newsHref}
      // (page, total, pageSize) — the BIRTH order. obituaryShowingLine is (page, pageSize, total)
      // and all three are numbers, so swapping them here compiles silently. Pinned by a test.
      showingLine={newsShowingLine(page, total, pageSize)}
    />
  );
}
