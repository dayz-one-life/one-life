import type { Metadata } from "next";
import { ServerPicker } from "@/components/map/server-picker";

export const metadata: Metadata = {
  title: "Maps",
  robots: { index: false }, // per-viewer: the friend counts are themselves private
};

export default function MapsPage() {
  return (
    <div className="mx-auto max-w-[68ch] px-4 py-8">
      <h1 className="font-display text-3xl uppercase tracking-[.02em]">Maps</h1>
      <div className="mt-6">
        <ServerPicker />
      </div>
    </div>
  );
}
