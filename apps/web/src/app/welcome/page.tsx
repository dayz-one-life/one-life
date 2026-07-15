import { redirect } from "next/navigation";
import { apiGet, getGamertagLinks } from "@/lib/api";
import { activeLink } from "@/lib/active-link";
import { playerSlug } from "@/lib/slug";

export const metadata = { robots: { index: false, follow: false } };

/**
 * Post-login resolver: sends a signed-in user to the right next step —
 * verified -> their player page, pending -> the account page (verification
 * banner), otherwise -> the claim flow.
 */
export default async function Welcome() {
  const session = await apiGet<{ user?: { id: string } }>("/api/auth/get-session").catch(() => null);
  if (!session?.user) redirect("/login");
  const links = await getGamertagLinks().catch(() => []);
  const link = activeLink(links);
  if (link?.status === "verified") redirect(`/players/${playerSlug(link.gamertag)}`);
  if (link?.status === "pending") redirect("/account");
  redirect("/account/claim");
}
