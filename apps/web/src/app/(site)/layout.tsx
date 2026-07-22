import type { ReactNode } from "react";
import { Masthead } from "@/components/header";
import { Footer } from "@/components/footer";
import { ControlsRail } from "@/components/controls/rail";

/** Every surface EXCEPT the map application. `/maps` deliberately sits outside this group so
 *  it can render its own full-viewport shell — see app/maps/layout.tsx. Route groups are not
 *  path segments, so nothing in here changed URL when it moved. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Masthead />
      <div className="mx-auto w-full max-w-[1440px] flex-1 xl:grid xl:grid-cols-[minmax(0,1fr)_380px] xl:px-10">
        <div id="main-content" tabIndex={-1} className="min-w-0 xl:border-r xl:border-ink xl:pr-8">
          {children}
        </div>
        <ControlsRail />
      </div>
      <Footer />
    </>
  );
}
