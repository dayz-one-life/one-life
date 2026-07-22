import type { Metadata } from "next";
import { Roster } from "@/components/friends/roster";

export const metadata: Metadata = {
  title: "The Roster",
  robots: { index: false }, // a per-viewer page has no business in a search index
};

export default function FriendsPage() {
  return (
    <div className="mx-auto max-w-[68ch] px-4 py-8">
      <h1 className="font-display text-3xl uppercase tracking-[.02em]">The Roster</h1>
      <div className="mt-6">
        <Roster />
      </div>
    </div>
  );
}
