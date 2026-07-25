import type { Metadata } from "next";
import { MapPage } from "@/components/map/map-page";

export const metadata: Metadata = {
  title: "Map",
  robots: { index: false }, // per-viewer coordinates have no business in a search index
};

/**
 * ⚠️ Inside the `(site)` route group since sub-project D3, so it renders the masthead, footer and
 * tab bar like every other page. **The URL is unchanged** — route groups are not path segments —
 * and `/maps` (the redirect) already lived in the group, so the two halves of `/maps*` finally
 * share a layout instead of one opting out.
 */
export default async function MapRoute({ params }: { params: Promise<{ map: string }> }) {
  const { map } = await params;
  return <MapPage slug={map} />;
}
