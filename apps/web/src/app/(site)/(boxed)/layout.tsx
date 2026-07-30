import type { ReactNode } from "react";

/**
 * The centered content box — every page in the site shell EXCEPT `/maps/[map]`, which sits
 * directly under `(site)` so the terrain can run edge to edge on a wide desktop. Route groups
 * are not path segments, so nothing in here has a different URL than before the split.
 *
 * ⚠️ THIS IS THE ONLY PLACE A CONTENT WIDTH IS DECLARED. Pages used to each set their own and
 * disagreed — 1024 on home/About/Obituaries, 68ch on Survivors/Friends, nothing at all on
 * Terms/Privacy/Welcome/Notifications/the dossier, which therefore filled the old 1440 box. A
 * page-level `mx-auto max-w-*` on a top-level element is a regression, not a local choice.
 * The exceptions are narrow-by-design ELEMENTS inside the box, not pages: `/login`'s `max-w-md`
 * form, and the `max-w-3xl` prose measure in `legal-doc.tsx` and `obituary-article.tsx`.
 *
 * ⚠️ The box owns the width, NEVER the horizontal padding. Pages keep their own inset because
 * it is deliberately not uniform: prose surfaces use `px-6 md:px-10`, while `/survivors/[map]`
 * and the dossier declare none and run their tables edge to edge below `xl`. Padding here would
 * put gutters on those tables.
 *
 * `flex flex-1 flex-col` continues the height chain from `#main-content` so pages that fill
 * the leftover viewport (none in this group today) still could; block children keep their
 * automatic height either way.
 */
export default function BoxedLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">{children}</div>;
}
