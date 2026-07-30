import type { ReactNode } from "react";
import { Masthead } from "@/components/header";
import { Footer } from "@/components/footer";

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
      {/* ⚠️ The bottom safe-area inset is NOT here — it is on the <Footer/>, which is the last
       *  in-flow element in the document. Padding this column instead leaves the footer itself
       *  under the phone's home indicator. (It used to reserve the fixed TabBar's 4rem as well;
       *  that bar is deleted — shell/nav-menu.tsx in the masthead is the nav now.) */}
      {/* ⚠️ `flex flex-col` is load-bearing for `/maps/[map]`, which fills the space the masthead
       *  and footer leave. `flex-1` already gave THIS element a height, but it was `display:
       *  block`, so a percentage height on a child had nothing to resolve against — the map page
       *  fell back to its min-height floor and Leaflet, which measures its container on creation,
       *  got a 2px box. Making this a column lets the page below grow instead of guessing.
       *
       *  ⚠️ NO max-width here — the 1440px box lives in the nested `(boxed)/layout.tsx`, which
       *  every page except `/maps/[map]` sits under. The map is the one surface where a centered
       *  box is wasted terrain, and a negative-margin "full bleed" escape from a max-w parent
       *  can't reach the viewport edge without risking horizontal overflow. */}
      <div id="main-content" tabIndex={-1} className="flex w-full flex-1 flex-col">
        {children}
      </div>
      <Footer />
    </>
  );
}
