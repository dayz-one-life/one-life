"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { getFriendMap, getServers, shareLocationWith, stopSharingAll, stopSharingWith } from "@/lib/api";
import { notFound } from "next/navigation";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendPositionDto } from "@/lib/types";
import { rememberMap } from "@/lib/map-resolution";
import { mapLabel } from "@/components/player/format";
import FriendsMap from "./friends-map";
import type { MapFocus } from "./map-canvas";
import { LocateButton } from "./shell/locate-button";
import { FriendsPanel } from "./shell/friends-panel";

// ⚠️ DARK SURFACE. The map region carries no paper anywhere — these notes sit over the terrain,
// so they use cream/paper tokens, never the light surfaces' `text-ink-muted`. That stays true
// even now that the page around it is the ordinary light site shell.
const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-cream-dim";

/** Every non-loaded state renders as a card OVER the map region, never in place of the page,
 *  so a blank canvas never stands in for "nobody is here". */
const CARD =
  "absolute inset-0 z-10 flex items-center justify-center bg-dark/80 p-6 text-center";

/** The non-blocking strip. It floats at the top of the map region rather than covering it —
 *  a card over the terrain would say "you may not look at this", which is not what is true of
 *  any of the states that use it. */
const STRIP =
  "pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-2";

export type MapPageViewProps = {
  /** The mission codename (`chernarusplus`), from the PUBLIC server list — this is what makes
   *  the terrain drawable without a session. Absent only while it is still resolving. */
  mapCodename?: string;
  /** The dots, from the session-gated payload. Empty for everyone who cannot have any. */
  positions?: readonly FriendPositionDto[];
  /** The MAP cannot be drawn yet / at all. Distinct from a friend-payload failure, which
   *  leaves a perfectly good map with no dots on it. */
  loading?: boolean;
  error?: boolean;
  signedOut?: boolean;
  unverified?: boolean;
  /** The gated payload failed. The terrain still renders; only the dots are missing. */
  friendsError?: boolean;
  now: Date;
  /** Where Locate last asked the map to fly. */
  focus?: MapFocus | null;
};

/**
 * Presentational.
 *
 * ⚠️ THE MAP ITSELF IS PUBLIC. Signing in adds the dots, the online list and Locate; it is not
 * a condition of seeing the terrain. This used to return the sign-in card INSTEAD of the map,
 * which meant every signed-out visitor to `/maps` got a sentence where a map should be — and
 * once Maps went into the primary nav that became the most-clicked dead end on the site.
 * Anything that is merely missing DOTS belongs in the strip, never in a blocking card.
 */
export function MapPageView(p: MapPageViewProps) {
  if (p.error) {
    return (
      <div className={CARD}>
        <p role="status" className={NOTE}>
          Couldn&apos;t load the map.
        </p>
      </div>
    );
  }
  if (p.loading || !p.mapCodename) {
    return (
      <div aria-busy="true" className={CARD}>
        <div
          aria-hidden
          className="h-full w-full motion-safe:animate-pulse bg-dark-well"
        />
      </div>
    );
  }

  const note = p.signedOut ? (
    <>
      {/* `red-deep` is a LIGHT-surface token; on dark it fails AA. Plain red passes here. */}
      <Link href="/login" className="font-bold text-red underline">
        Sign in
      </Link>{" "}
      to see where your friends are.
    </>
  ) : p.unverified ? (
    "Verify your gamertag to see your friends here."
  ) : p.friendsError ? (
    // "Couldn't load" and "nobody is sharing" are different claims about the game; an empty
    // map must never be allowed to stand in for the first.
    "Couldn't load who's on the map."
  ) : null;

  return (
    <>
      <FriendsMap
        mapCodename={p.mapCodename}
        positions={p.positions ?? []}
        now={p.now}
        focus={p.focus}
      />
      {note && (
        <div className={STRIP}>
          <p
            role="status"
            className={`pointer-events-auto border border-dark-edge bg-dark/90 px-3 py-1.5 text-center ${NOTE}`}
          >
            {note}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * `/maps/[map]` — an ordinary page inside the site shell since sub-project D3. It used to be a
 * full-viewport application with its own two bars of chrome; the masthead is the way home now,
 * and the hamburger menu in it covers what the map's own bottom bar did.
 *
 * ⚠️ It supplies NO `#main-content`. It used to, because it sat outside the `(site)` route group
 * and the root layout's skip link had no other target. Inside the group, `(site)/layout.tsx`
 * provides that id, and a second element carrying it would make the skip link resolve to
 * whichever comes first in the document.
 *
 * ⚠️ The map needs a parent with a DEFINITE height. Leaflet measures its container on creation,
 * so a parent chain with no resolved height collapses the canvas to zero. The old full-viewport
 * flex column supplied that; the explicit height below replaces it.
 */
export function MapPage({ slug }: { slug: string }) {
  const account = useAccountStatus();
  const verified = account.kind === "verified";
  const [focus, setFocus] = useState<MapFocus | null>(null);

  // ⚠️ The PUBLIC server list, not the gated `/me/maps`. It carries `map` (the mission codename)
  // alongside `slug`, which is the whole reason the terrain can draw for a signed-out visitor —
  // MapCanvas needs the codename to pick its tile tree and place labels, and until this the only
  // source of it was a session-gated payload. It also feeds the switcher, so changing maps works
  // logged out too.
  const servers = useQuery({ queryKey: ["servers"], queryFn: getServers });
  const currentServer = servers.data?.find((s) => s.slug === slug);
  const mapCodename = currentServer?.map;
  // Only once the list has loaded can an unknown slug be told apart from a pending one.
  const unknownSlug = Boolean(servers.data) && !currentServer;

  // What makes the nav's `/maps` link land where you left off — but only for a REAL map, now
  // that the route is public and any segment renders. Gated on `mapCodename` so a typo we are
  // about to 404 is never written into the cookie the redirect reads back.
  useEffect(() => { if (mapCodename) rememberMap(slug); }, [slug, mapCodename]);

  const q = useQuery({
    queryKey: ["friend-map", slug],
    // A bad slug 404s below; no point asking the gated route about a map that does not exist.
    enabled: verified && Boolean(currentServer),
    queryFn: () => getFriendMap(slug),
    refetchInterval: 30_000,
  });

  // Grant mutations. Both invalidate the map payload, which is the single source of both
  // directions of sharing — so the chip, the dots and the row buttons can never disagree.
  const qc = useQueryClient();
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ["friend-map", slug] }); };
  const share = useMutation({
    mutationFn: (gamertag: string) => shareLocationWith(slug, gamertag),
    onSettled: () => { setPendingFor(null); invalidate(); },
  });
  const unshare = useMutation({
    mutationFn: (gamertag: string) => stopSharingWith(slug, gamertag),
    onSettled: () => { setPendingFor(null); invalidate(); },
  });
  const unshareAll = useMutation({
    mutationFn: () => stopSharingAll(slug),
    onSettled: invalidate,
  });

  // ⚠️ AFTER every hook. `notFound()` throws, and a conditional throw sitting ABOVE a hook would
  // skip it on the render that 404s — a rules-of-hooks violation. A public, directly-linkable
  // route means `/maps/<typo>` and stale links are reachable; they must 404, not render a
  // "couldn't load" card claiming a failure that did not happen.
  if (unknownSlug) notFound();

  return (
    // ⚠️ The height chain that makes the map fill the space the masthead and footer leave:
    // `<body>` is `min-h-screen flex-col` → the (site) layout's `#main-content` is `flex-1` AND
    // `flex-col` → this page is `flex-1` → the map box below is `flex-1 min-h-0`. Every link is
    // required. An earlier version used `h-full` here, but `#main-content` was `display: block`,
    // so the percentage had nothing to resolve against: the page fell back to the floor and
    // Leaflet, which measures its container on creation, got a 2px box.
    // `min-h-[420px]` is the short-viewport floor, where filling would leave a sliver.
    <div className="flex min-h-[420px] flex-1 flex-col">
      {/* No visible header strip — the mock's rule is "the dropdown is the only header
          addition", and the switcher lives in the MASTHEAD right cluster (header.tsx's
          MastheadMapSwitcher). The h1 stays for AT and SEO; the terrain is the page. */}
      <h1 className="sr-only">{mapCodename ? mapLabel(mapCodename) : "Map"}</h1>

      {/* The route sits OUTSIDE the (boxed) group, so the terrain runs edge to edge on any
          viewport — no negative-margin escape needed.

          ⚠️ `isolate`: Leaflet's own controls sit at z-index 1000 and would otherwise paint over
          the z-40 masthead and the z-50 overlays. That was always true; with a masthead above
          the map it is now the thing standing between the two. See header.tsx's LAYER LEGEND. */}
      <div className="map-app relative isolate min-h-0 w-auto flex-1 border-y border-ink">
        <MapPageView
          signedOut={account.kind === "signedOut"}
          unverified={account.kind === "unlinked" || account.kind === "pending"}
          // ⚠️ The map's own loading/error come from the PUBLIC server list only. The gated
          // friend payload must never gate the terrain — that is the bug this replaced. An
          // unknown slug is not an error here; it has already `notFound()`d above.
          loading={servers.isPending}
          error={servers.isError && !servers.data}
          friendsError={q.isError && !q.data}
          mapCodename={mapCodename}
          positions={q.data?.positions}
          focus={focus}
          now={new Date()}
        />

        {/* ⚠️ The permanent sharing chip. It reports the OUTBOUND direction — who can see YOU —
            which nothing else on this page shows, and it renders only once the payload has
            resolved: a "0 can see you" drawn from a loading or failed fetch is a claim about
            your privacy made from an unknown. Every session starts at zero by construction,
            because every grant dies with the session that made it. */}
        {verified && q.data && q.data.sharingWith.length > 0 && (
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 border border-dark-edge bg-dark/90 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[.05em] text-paper">
            <span>
              {q.data.sharingWith.length} can see you
            </span>
            <button
              type="button"
              disabled={unshareAll.isPending}
              onClick={() => unshareAll.mutate()}
              className="font-bold text-red underline disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        )}

        {/* Locate and Online overlay the map's bottom-right. Signed-out and unverified visitors
            get no controls at all: the friend query is disabled for them, so `isPending` never
            resolves and Locate would sit claiming to load a position that is never coming. */}
        {verified && (
          <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-1">
            <div className="pointer-events-auto flex items-center gap-1">
              <LocateButton
                self={q.data?.positions.find((p) => p.self)}
                loading={q.isPending}
                error={q.isError && !q.data}
                mapCodename={mapCodename ?? ""}
                onLocate={setFocus}
              />
              <FriendsPanel
                players={q.data?.online}
                positions={q.data?.positions}
                now={new Date()}
                loading={q.isPending}
                error={q.isError && !q.data}
                onShare={(g) => { setPendingFor(g); share.mutate(g); }}
                onStopSharing={(g) => { setPendingFor(g); unshare.mutate(g); }}
                pendingFor={pendingFor}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
