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
      {/* The bottom padding reserves space for the fixed TabBar below `md`. Without it the bar
       *  covers the last rows of every scrollable page. It drops away at `md`, where the bar is
       *  hidden anyway. */}
      <div
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1440px] flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 xl:px-10"
      >
        {children}
      </div>
      <Footer />
      <TabBar />
    </>
  );
}
