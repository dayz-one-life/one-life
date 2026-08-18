import type { Metadata } from "next";
import { ModerationBody } from "./moderation-body";

// Reached by URL only — deliberately no nav link into it (out of scope for this task). Every
// moderation route re-checks `isModerator` server-side regardless of what this page shows.
export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};

export default function ModerationPage() {
  return <ModerationBody />;
}
