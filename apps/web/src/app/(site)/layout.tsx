import type { ReactNode } from "react";
import { Masthead } from "@/components/header";
import { Footer } from "@/components/footer";
import { TabBar } from "@/components/shell/tab-bar";

/**
 * Every surface EXCEPT the map application. `/maps/[map]` deliberately sits outside this group so
 * it can render its own full-viewport shell. Route groups are not path segments, so nothing in
 * here changed URL when it moved.
 *
 * The two-column grid used to live here, with the controls rail pinned in the right column of
 * EVERY page. It moved into Home (`app/(site)/page.tsx`), which is now the only page with a
 * sidebar — every other page in the group gets its full width back.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Masthead />
      {/* ⚠️ The TabBar gutter is NOT here — it is on the <Footer/>, which is the last in-flow
       *  element in the document. Padding this column instead leaves the footer itself under the
       *  fixed bar, which hid the footer's About link (its only route below `md`). */}
      {/* ⚠️ `flex flex-col` is load-bearing for `/maps/[map]`, which fills the space the masthead
       *  and footer leave. `flex-1` already gave THIS element a height, but it was `display:
       *  block`, so a percentage height on a child had nothing to resolve against — the map page
       *  fell back to its min-height floor and Leaflet, which measures its container on creation,
       *  got a 2px box. Making this a column lets the page below grow instead of guessing.
       *
       *  Safe for every other page: a block child of a column flex container keeps its automatic
       *  height (nothing grows without `flex-grow`) and already stretched to full width. */}
      <div id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col xl:px-10">
        {children}
      </div>
      <Footer />
      <TabBar />
    </>
  );
}
