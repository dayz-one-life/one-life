import { getGamertagLinks } from "./api";
import { playerSlug } from "./slug";

/**
 * The signed-in viewer's OWN player slug, or null when signed out or not yet verified.
 *
 * ⚠️ Takes no subject parameter — the session is the only input, so asking "is this page mine?"
 * about somebody else is unexpressible rather than merely rejected.
 *
 * ⚠️ The boundary is a `verified` link, never `pending`. A pending claim is an assertion the
 * player has not yet proved, and redirecting on it would let anyone bounce a stranger's dossier
 * to their own home by claiming their gamertag.
 *
 * ⚠️ Never throws. A failed links fetch means "we don't know", which must render the page as a
 * stranger's rather than 500 a public profile that has nothing to do with the session.
 */
export async function ownVerifiedSlug(): Promise<string | null> {
  try {
    const links = await getGamertagLinks();
    const verified = links.find((l) => l.status === "verified");
    return verified ? playerSlug(verified.gamertag) : null;
  } catch {
    return null;
  }
}
