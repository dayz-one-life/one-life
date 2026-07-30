import type { ReactNode } from "react";

/**
 * The centered content box — every page in the site shell EXCEPT `/maps/[map]`, which sits
 * directly under `(site)` so the terrain can run edge to edge on a wide desktop. Route groups
 * are not path segments, so nothing in here has a different URL than before the split.
 *
 * ⚠️ THIS IS THE ONLY PLACE A CONTENT WIDTH IS DECLARED. Pages used to each set their own and
 * disagreed — 1024 on home/About/Obituaries/the life timeline, 1024 on the Survivors board and
 * the dossier (matching, but by coincidence), 768 on Terms/Privacy via `legal-doc.tsx`, 672 on
 * Notifications via `inbox.tsx`, and 68ch on `/friends` and the `/survivors` redirect's failure
 * page. A page-level `mx-auto max-w-*` on a top-level element is a regression, not a local
 * choice. The exceptions are narrow-by-design ELEMENTS inside the box, not pages: `/login`'s
 * `max-w-md` form, and the `max-w-3xl` prose measure in `legal-doc.tsx` and
 * `obituary-article.tsx`. One page-level exception survives OUTSIDE the box: `/maps`'s
 * redirect-failure page (`app/(site)/maps/page.tsx`) keeps `mx-auto max-w-[68ch]` because it
 * sits under `(site)`, not `(boxed)` — nothing else would constrain it, so it would run
 * full-bleed. Its `/survivors` twin lost the same classes precisely because it IS in here.
 *
 * ⚠️ The box owns the width, NEVER the horizontal padding. Pages keep their own inset because
 * it is deliberately not uniform: prose surfaces use `px-6 md:px-10` (the Survivors board and
 * the legal pages among them), while the dossier declares NONE on `<main>` — its dark back-link
 * strip, hero and slabs each state their own inset so they measure identically, and a padded
 * wrapper is what made them read narrower than the hero. Padding here would reintroduce exactly
 * that, on every page at once.
 *
 * `flex flex-1 flex-col` continues the height chain from `#main-content` so pages that fill
 * the leftover viewport (none in this group today) still could; block children keep their
 * automatic height either way.
 */
export default function BoxedLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">{children}</div>;
}
