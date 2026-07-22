import type { Metadata } from "next";
import { ServerPicker } from "@/components/map/server-picker";

export const metadata: Metadata = {
  title: "Maps",
  robots: { index: false }, // per-viewer: the friend counts are themselves private
};

/** ⚠️ The PICKER stays inside the (site) route group; only `/maps/[map]`, the map tool itself,
 *  opts out. It is an ordinary list page: it needs the masthead, the footer and the light
 *  surface its tokens are written in. Moved out of `app/maps/` after the shell split orphaned
 *  it — no chrome, no way back, and every ink token invisible on the dark shell. */
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
