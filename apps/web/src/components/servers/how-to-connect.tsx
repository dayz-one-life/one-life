import type { Server } from "@/lib/types";

/**
 * The three states a server list can be in. Loading, genuinely-empty and failed are three
 * distinct renders — this repo's most-repeated bug class, and the reason this is a union rather
 * than a `Server[]` that collapses "we don't know" into "there are none".
 */
export type ServersView =
  | { kind: "loading" }
  | { kind: "ready"; names: string[] }
  | { kind: "failed" };

/**
 * ⚠️ The site-wide search term is BRAND COPY, not fleet data.
 *
 * Every server's in-game browser name is `One Life <Map> | dayzonelife.com`, so searching this one
 * term finds all of them. It is deliberately NOT derived from `servers.name`, which holds the map
 * label alone ("Chernarus") — telling a player to search that would return thousands of unrelated
 * servers.
 *
 * By the same token this panel does NOT print the full browser name: we do not store it (it lives
 * in each server's Nitrado config), so any exact string here would be a guess that goes silently
 * stale the first time a server is renamed. The search term plus the map list is true either way.
 */
export const SEARCH_TERM = "One Life";

/**
 * ⚠️ There is no "Join server" button anywhere in this app, because a console DayZ server has no
 * join URL. Connecting is a manual search in the in-game browser, and this panel is the honest
 * description of it.
 *
 * Used in three places — the cold home, the claim search's empty state, and the verified home's
 * idle rows — so it is one component and the copy cannot drift between them.
 *
 * ⚠️ The map list comes from `getServers()`, NEVER a hardcoded list. The fleet is three today and
 * four when Badlands ships.
 */
export function HowToConnect({ servers, onDark = false }: { servers: ServersView; onDark?: boolean }) {
  const heading = onDark ? "text-paper" : "text-ink";
  const body = onDark ? "text-cream-muted" : "text-ink-soft";
  const rule = onDark ? "border-dark-line" : "border-hairline";

  return (
    <section aria-label="How to connect" className={`border-t ${rule} pt-4`}>
      <h3 className={`font-display text-[13px] font-bold uppercase tracking-[.12em] ${heading}`}>
        How to connect
      </h3>
      <ol className={`mt-3 flex flex-col gap-2.5 font-sans text-base leading-relaxed ${body}`}>
        <li>
          In DayZ, open the server browser and search{" "}
          <strong className={heading}>{SEARCH_TERM}</strong>.
        </li>
        <li>
          <ServerNames servers={servers} onDark={onDark} />
        </li>
        <li>Favourite them so you can find them again without searching.</li>
      </ol>
    </section>
  );
}

function ServerNames({ servers, onDark }: { servers: ServersView; onDark: boolean }) {
  const strong = onDark ? "text-paper" : "text-ink";

  if (servers.kind === "loading") {
    return (
      <span aria-busy="true">
        Pick the map you want to play.{" "}
        <span className="sr-only">Loading the server list…</span>
      </span>
    );
  }

  // A failed fetch must never render as "there are no servers" — it is not evidence about the
  // fleet. The instruction that does not depend on the list still stands.
  if (servers.kind === "failed") {
    return <span>Pick the map you want to play — we couldn&rsquo;t load the list just now.</span>;
  }

  // Resolved-but-empty is a real (if alarming) answer, and says so rather than printing
  // "You'll see one server per map:" followed by nothing.
  if (servers.names.length === 0) {
    return <span>No servers are currently listed.</span>;
  }

  return (
    <span>
      You&rsquo;ll see one server per map:{" "}
      <strong className={strong}>{servers.names.join(", ")}</strong>. Pick the one you want to
      play.
    </span>
  );
}

/** Adapts the shapes the two call sites already hold into a `ServersView`. */
export function serversView(servers: Server[] | null, opts: { loading?: boolean; failed?: boolean } = {}): ServersView {
  if (opts.loading) return { kind: "loading" };
  if (opts.failed || servers === null) return { kind: "failed" };
  return { kind: "ready", names: servers.map((s) => s.name) };
}
