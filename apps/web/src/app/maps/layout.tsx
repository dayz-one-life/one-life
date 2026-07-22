import type { ReactNode } from "react";

/** The map application shell. `/maps` sits outside the (site) route group precisely so it
 *  renders none of the site chrome — see app/(site)/layout.tsx.
 *
 *  `dvh`, not `vh`: collapsing mobile browser chrome must not push the map under the address
 *  bar. `overflow-hidden` because the map pans; the page itself never scrolls. */
export default function MapLayout({ children }: { children: ReactNode }) {
  return <div className="flex h-[100dvh] w-full flex-col overflow-hidden">{children}</div>;
}
