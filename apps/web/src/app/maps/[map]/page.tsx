import type { Metadata } from "next";
import { MapPage } from "@/components/map/map-page";

export const metadata: Metadata = {
  title: "Map",
  robots: { index: false }, // per-viewer coordinates have no business in a search index
};

export default async function MapRoute({ params }: { params: Promise<{ map: string }> }) {
  const { map } = await params;
  // The map IS the application: no heading, no page padding, no site chrome. The shell's
  // height comes from app/maps/layout.tsx; MapPage owns the bar and the map region.
  return <MapPage slug={map} />;
}
