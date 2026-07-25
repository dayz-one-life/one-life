import type { ReactNode } from "react";

/**
 * The centered 1440px content box — every page in the site shell EXCEPT `/maps/[map]`, which
 * sits directly under `(site)` so the terrain can run edge to edge on a wide desktop. Route
 * groups are not path segments, so nothing in here has a different URL than before the split.
 *
 * `flex flex-1 flex-col` continues the height chain from `#main-content` so pages that fill
 * the leftover viewport (none in this group today) still could; block children keep their
 * automatic height either way.
 */
export default function BoxedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col xl:px-10">{children}</div>
  );
}
