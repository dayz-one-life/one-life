import type { Metadata } from "next";
import { TeaserPage } from "@/components/teaser-page";

export const metadata: Metadata = { title: "Obituaries", robots: { index: false } };

export default function ObituariesPage() {
  return (
    <TeaserPage
      kicker="Obituaries"
      title="The morgue desk is hiring."
      line="EVERY QUALIFIED DEATH WILL GET ITS WRITE-UP. THE DEAD CAN WAIT. THEY'RE GOOD AT IT. DEVELOPING."
    />
  );
}
