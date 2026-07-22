import type { Metadata } from "next";
import { MapPage } from "@/components/map/map-page";

export const metadata: Metadata = {
  title: "Map",
  robots: { index: false }, // per-viewer coordinates have no business in a search index
};

export default async function MapRoute({ params }: { params: Promise<{ map: string }> }) {
  const { map } = await params;
  return (
    <div className="mx-auto max-w-[68ch] px-4 py-8">
      <h1 className="font-display text-3xl uppercase tracking-[.02em]">Map</h1>
      <div className="mt-6">
        <MapPage slug={map} />
      </div>
    </div>
  );
}
