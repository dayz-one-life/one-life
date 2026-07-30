/** The invite-link referral cookie. Written by /i/[slug], read by the claim Route Handler. */
export const REFERRAL_COOKIE = "ol_ref";
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Player slugs are `[a-z0-9-]` by construction (see `playerSlug`). Anything else never reaches
 * the cookie — the value is echoed into a Set-Cookie header and later into an API call.
 */
export function isStorableSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(slug);
}
