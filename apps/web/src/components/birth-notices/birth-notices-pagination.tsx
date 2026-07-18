import { NumberedPager } from "@/components/shared/numbered-pager";
import { freshSpawnsHref, birthShowingLine } from "@/lib/birth-format";

export function BirthNoticesPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  return (
    <NumberedPager
      page={page}
      total={total}
      pageSize={pageSize}
      hrefFor={freshSpawnsHref}
      showingLine={birthShowingLine(page, total, pageSize)}
    />
  );
}
