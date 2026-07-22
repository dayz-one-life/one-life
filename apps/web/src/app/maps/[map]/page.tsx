import type { Metadata } from "next";
import { MapPage } from "@/components/map/map-page";

export const metadata: Metadata = {
  title: "Map",
  robots: { index: false }, // per-viewer coordinates have no business in a search index
};

export default async function MapRoute({ params }: { params: Promise<{ map: string }> }) {
  const { map } = await params;
  return (
    // The map IS the page: full column width (the 68ch measure is a reading-prose rule, not a
    // layout default) and a definite height so the canvas can fill it. `dvh` over `vh` so mobile
    // browser chrome collapsing does not leave the map running under the address bar.
    <div className="flex h-[calc(100dvh-7rem)] min-h-[520px] flex-col px-4 py-6">
      <h1 className="font-display text-3xl uppercase tracking-[.02em]">Map</h1>
      <div className="mt-4 min-h-0 flex-1">
        <MapPage slug={map} />
      </div>
    </div>
  );
}
