import { redirect } from "next/navigation";
import { apiGet } from "@/lib/api";

export const metadata = { robots: { index: false, follow: false } };

/**
 * Post-login resolver: sends a signed-in user to the right next step.
 *
 * ⚠️ EVERY signed-in destination is now `/`. A verified player used to be sent to
 * `/players/{slug}`, which since the verified-home redesign 307s straight back here — the home
 * page IS their dossier now. This page renders nothing, so the referral claim island cannot
 * mount here; it mounts on signed-in `/`, which is where this lands.
 */
export default async function Welcome() {
  const session = await apiGet<{ user?: { id: string } }>("/api/auth/get-session").catch(() => null);
  if (!session?.user) redirect("/login");
  redirect("/");
}
