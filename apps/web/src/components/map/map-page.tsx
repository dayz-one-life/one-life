"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getFriendMap, getServers } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendPositionDto, Server } from "@/lib/types";
import { rememberMap } from "@/lib/last-map";
import FriendsMap from "./friends-map";
import type { MapFocus } from "./map-canvas";
import { TopBar } from "./shell/top-bar";
import { MapBottomBar } from "./shell/bottom-bar";
import { CoordChip } from "./shell/coord-chip";
import { PlaceSearch } from "./shell/place-search";
import { LocateButton } from "./shell/locate-button";
import { FriendsPanel } from "./shell/friends-panel";

// ⚠️ DARK SURFACE. The shell has no paper anywhere — these notes sit over the map region, so
// they carry cream/paper tokens, never the light surfaces' `text-ink-muted`.
const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-cream-dim";

/** Every non-loaded state renders as a card OVER the map region, with the bar still above it,
 *  so the route is always escapable and a blank canvas never stands in for "nobody is here". */
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
  /** Where the search box last asked the map to fly. */
  focus?: MapFocus | null;
  /** Lifted out of FriendsMap: the grid chip is chrome now, not an overlay on the canvas. */
  onCenterChange?: (world: { x: number; y: number }) => void;
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
        onCenterChange={p.onCenterChange}
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

export function MapPage({ slug }: { slug: string }) {
  const account = useAccountStatus();
  const verified = account.kind === "verified";
  const [focus, setFocus] = useState<MapFocus | null>(null);
  // The map centre, in world metres. Owned HERE rather than in FriendsMap because the chip
  // that reads it is chrome: on a phone it sits in the bottom bar, outside the map entirely.
  const [world, setWorld] = useState<{ x: number; y: number } | null>(null);
  // What makes the nav's `/maps` link land where you left off. Written for EVERY visitor,
  // signed in or not — a signed-out browser still has a map they were looking at. The slug is
  // stored unvalidated (this route renders for any segment), which is safe because the read
  // side re-checks it against the live server list; see resolveMapSlug in lib/last-map.ts.
  useEffect(() => { rememberMap(slug); }, [slug]);

  // ⚠️ The PUBLIC server list, not the gated `/me/maps`. It carries `map` (the mission codename)
  // alongside `slug`, which is the whole reason the terrain can draw for a signed-out visitor —
  // MapCanvas needs the codename to pick its tile tree and place labels, and until this the only
  // source of it was a session-gated payload. It also feeds the switcher, so changing maps works
  // logged out too.
  const servers = useQuery({ queryKey: ["servers"], queryFn: getServers });
  const mapServers = servers.data
    ?.filter((s): s is Server & { slug: string } => Boolean(s.slug))
    .map((s) => ({ slug: s.slug, name: s.name }));
  const mapCodename = servers.data?.find((s) => s.slug === slug)?.map;

  const q = useQuery({
    queryKey: ["friend-map", slug],
    queryFn: () => getFriendMap(slug),
    enabled: verified,
    refetchInterval: 30_000,
  });

  // Built once, placed twice — see the note at the top-bar slot below.
  const controls = verified ? (
    <>
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
      />
    </>
  ) : null;

  return (
    <>
      <TopBar slug={slug} servers={mapServers} serversLoading={servers.isPending}>
        {/* Search needs the mission codename to look places up, so the box appears with the
            terrain — which now means it works for signed-out visitors too. */}
        {mapCodename && <PlaceSearch mapCodename={mapCodename} onPick={setFocus} />}
        {/* Signed-out and unverified visitors get no controls at all: the friend query is
            disabled for them, so `isPending` never resolves and Locate would sit there
            claiming to be loading a position that is never coming. */}
        {/* ⚠️ These two ALSO render in the bottom bar, and only one copy is ever visible —
            `hidden`/`md:hidden` is display:none, which also removes the hidden copy from the
            accessibility tree. Same pattern as the ControlsRail/ControlsSheet pair. jsdom
            applies no CSS, so the suite cannot prove the exclusivity; it is on the browser
            checklist instead. */}
        <div className="hidden md:flex md:items-center md:gap-1">{controls}</div>
      </TopBar>
      {/* The root layout's skip link points at #main-content, which lives in the (site) layout
          this route deliberately opts out of — so the shell supplies its own target, and it is
          the map region, not the bar the link exists to skip. */}
      <div id="main-content" tabIndex={-1} className="relative min-h-0 flex-1">
        <MapPageView
          signedOut={account.kind === "signedOut"}
          unverified={account.kind === "unlinked" || account.kind === "pending"}
          // ⚠️ The map's own loading/error come from the PUBLIC server list only. The gated
          // friend payload must never gate the terrain — that is the bug this replaced.
          loading={servers.isPending}
          error={(servers.isError && !servers.data) || (Boolean(servers.data) && !mapCodename)}
          friendsError={q.isError && !q.data}
          mapCodename={mapCodename}
          positions={q.data?.positions}
          focus={focus}
          onCenterChange={setWorld}
          now={new Date()}
        />
        {/* From md up the chip floats over the map's bottom-left, as it always has. Below md
            it lives in the bottom bar instead — within thumb reach, and clear of the map. */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden md:block">
          <div className="pointer-events-auto">
            <CoordChip world={world} />
          </div>
        </div>
      </div>
      <MapBottomBar chip={<CoordChip world={world} />}>{controls}</MapBottomBar>
    </>
  );
}
