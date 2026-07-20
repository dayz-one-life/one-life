import { ArticleHeroSkeleton } from "@/components/skeletons";

/** The interior's own skeleton. Without this file the feed-segment `news/loading.tsx` above would
 *  serve `/news/[slug]` too — a FEED skeleton for an ARTICLE, which is what `obituaries/loading.tsx`
 *  currently does for the obituary interior. News is the only kind that renders a hero image, so a
 *  16:9 photo frame is the honest placeholder here. This is also what makes Task 2 Step 5's replacement
 *  comment on `ArticleHeroSkeleton` true: before this file, nothing rendered it. */
export default function Loading() {
  return (
    // aria-busy matches ObituariesSkeleton's own <main>, which this file's sibling reuses.
    <main aria-busy="true" className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      <ArticleHeroSkeleton />
    </main>
  );
}
