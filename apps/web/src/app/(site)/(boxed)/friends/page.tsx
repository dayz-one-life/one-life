import type { Metadata } from "next";
import { Roster } from "@/components/friends/roster";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = {
  title: "Friends",
  robots: { index: false }, // a per-viewer page has no business in a search index
};

export default function FriendsPage() {
  return (
    <div className="w-full px-4 py-8">
      {/* No `count` here: the roster owns its own loading/empty/failed states and already reports
       *  its totals honestly. A second count in the header would be a second source of truth. */}
      <PageHeader title="Friends" />
      <div className="mt-6">
        <Roster />
      </div>
    </div>
  );
}
