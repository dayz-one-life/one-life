import type { GamertagLink } from "./types";
import { activeLink } from "./active-link";

export type AccountStatus =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "unlinked" }
  | { kind: "pending"; link: GamertagLink }
  | { kind: "verified"; link: GamertagLink };

/** Single source of truth for the banner and the masthead slot. */
export function accountStatus(args: {
  signedIn: boolean;
  loading: boolean;
  links: GamertagLink[] | undefined;
}): AccountStatus {
  if (args.loading) return { kind: "loading" };
  if (!args.signedIn) return { kind: "signedOut" };
  const active = activeLink(args.links);
  if (!active) return { kind: "unlinked" };
  return active.status === "verified"
    ? { kind: "verified", link: active }
    : { kind: "pending", link: active };
}

/** True while any link is pending — gates live polling of the links query. */
export function hasPendingLink(links: GamertagLink[] | undefined): boolean {
  return links?.some((l) => l.status === "pending") ?? false;
}
