import type { Metadata } from "next";
import { TeaserPage } from "@/components/teaser-page";

export const metadata: Metadata = { title: "Fresh Spawns", robots: { index: false } };

export default function FreshSpawnsPage() {
  return (
    <TeaserPage
      kicker="Birth notices"
      kickerColor="blue"
      title="New fools wash ashore daily."
      line="A NOTICE FOR EVERY QUALIFIED LIFE. WE WISH THEM LONG AND PROSPEROUS LIVES. IT WILL NOT BE. DEVELOPING."
    />
  );
}
