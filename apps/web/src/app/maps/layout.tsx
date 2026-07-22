import type { ReactNode } from "react";

/** The map application shell, for `/maps/[map]` only — the picker at `/maps` stays a normal
 *  site page in the (site) route group. This subtree sits outside that group precisely so it
 *  renders none of the site chrome — see app/(site)/layout.tsx.
 *
 *  `dvh`, not `vh`: collapsing mobile browser chrome must not push the map under the address
 *  bar. `overflow-hidden` because the map pans; the page itself never scrolls. */
export default function MapLayout({ children }: { children: ReactNode }) {
  return <div className="flex h-[100dvh] w-full flex-col overflow-hidden">{children}</div>;
}
