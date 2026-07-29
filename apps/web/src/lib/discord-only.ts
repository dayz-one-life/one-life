/**
 * ⚠️ THIS MODULE MUST NEVER CARRY "use client".
 *
 * `login/page.tsx` is a SERVER component and CALLS this predicate. React Server Components lets a
 * client *component* be rendered from the server, but calling a plain function out of a client
 * module throws at request time:
 *
 *   Error: Attempted to call isDiscordOnly() from the server but isDiscordOnly is on the client.
 *
 * That is exactly what shipped in v0.57.0, where this function lived in `discord-redirect.tsx`
 * beside the "use client" directive: every /login request 500'd in production while the whole test
 * suite stayed green, because vitest/jsdom does not model the RSC boundary and `tsc` cannot see it.
 * Keep the predicate here, server-safe, and the component over there.
 */

/** True only when Discord is the sole way in — any other configuration (dev magic-link, extra
 *  providers, a FAILED providers fetch) keeps the button page (home-polish spec §7). */
export function isDiscordOnly(methods: { providers: string[]; magicLink: boolean } | null): boolean {
  return !!methods && !methods.magicLink && methods.providers.length === 1 && methods.providers[0] === "discord";
}
