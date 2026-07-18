import { NumberedPager } from "@/components/shared/numbered-pager";
import { obituariesHref, obituaryShowingLine } from "@/lib/obituary-format";

export function ObituariesPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  return (
    <NumberedPager
      page={page}
      total={total}
      pageSize={pageSize}
      hrefFor={obituariesHref}
      showingLine={obituaryShowingLine(page, pageSize, total)}
    />
  );
}
