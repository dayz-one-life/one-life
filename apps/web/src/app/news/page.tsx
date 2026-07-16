import type { Metadata } from "next";
import { TeaserPage } from "@/components/teaser-page";

export const metadata: Metadata = { title: "News", robots: { index: false } };

export default function NewsPage() {
  return (
    <TeaserPage
      kicker="News"
      title="The presses are warming up."
      line="EVERY LIFE A STORY. EVERY DEATH AN EXCLUSIVE. THE DESK IS STAFFING UP. DEVELOPING."
    />
  );
}
