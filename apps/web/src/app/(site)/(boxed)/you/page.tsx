import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { YouPanel } from "@/components/account/you-panel";

export const metadata: Metadata = {
  title: "You",
  robots: { index: false }, // a per-viewer account page has no business in a search index
};

export default function YouPage() {
  return (
    <div className="mx-auto max-w-[68ch] px-4 py-8">
      <PageHeader title="You" />
      <div className="mt-6">
        <YouPanel />
      </div>
    </div>
  );
}
