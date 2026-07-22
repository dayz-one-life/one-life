"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getFriendMap, getMapServers } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendMap } from "@/lib/types";
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

export type MapPageViewProps = {
  data?: FriendMap;
  loading?: boolean;
  error?: boolean;
  signedOut?: boolean;
  unverified?: boolean;
  now: Date;
  /** Where the search box last asked the map to fly. */
  focus?: MapFocus | null;
  /** Lifted out of FriendsMap: the grid chip is chrome now, not an overlay on the canvas. */
  onCenterChange?: (world: { x: number; y: number }) => void;
};

/** Presentational. Five states, never collapsed: signed out, unverified, loading, failed,
 *  loaded. A blank canvas would read as "nobody is here", which is a different claim. */
export function MapPageView(p: MapPageViewProps) {
  if (p.signedOut) {
    return (
      <div className={CARD}>
        <p role="status" className={NOTE}>
          {/* `red-deep` is a LIGHT-surface token; on dark it fails AA. Plain red passes here. */}
          <Link href="/login" className="font-bold text-red underline">
            Sign in
          </Link>{" "}
          to see where your friends are.
        </p>
      </div>
    );
  }
  if (p.unverified) {
    return (
      <div className={CARD}>
        <p role="status" className={NOTE}>
          Verify your gamertag to use the map.
        </p>
      </div>
    );
  }
  if (p.loading) {
    return (
      <div aria-busy="true" className={CARD}>
        <div
          aria-hidden
          className="h-full w-full motion-safe:animate-pulse bg-dark-well"
        />
      </div>
    );
  }
  if (p.error) {
    return (
      <div className={CARD}>
        <p role="status" className={NOTE}>
          Couldn&apos;t load the map.
        </p>
      </div>
    );
  }
  if (!p.data) return null;
  return (
    <FriendsMap data={p.data} now={p.now} focus={p.focus} onCenterChange={p.onCenterChange} />
  );
}

export function MapPage({ slug }: { slug: string }) {
  const account = useAccountStatus();
  const verified = account.kind === "verified";
  const [focus, setFocus] = useState<MapFocus | null>(null);
  // The map centre, in world metres. Owned HERE rather than in FriendsMap because the chip
  // that reads it is chrome: on a phone it sits in the bottom bar, outside the map entirely.
  const [world, setWorld] = useState<{ x: number; y: number } | null>(null);
  const servers = useQuery({ queryKey: ["map-servers"], queryFn: getMapServers, enabled: verified });
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
        mapCodename={q.data?.mapCodename ?? ""}
        onLocate={setFocus}
      />
      <FriendsPanel
        players={q.data?.online}
        loading={q.isPending}
        error={q.isError && !q.data}
      />
    </>
  ) : null;

  return (
    <>
      <TopBar slug={slug} servers={servers.data?.servers} serversLoading={servers.isPending}>
        {/* Search needs the mission codename to look places up, and only the loaded payload
            knows it — so the box appears with the map, not before it. */}
        {q.data && <PlaceSearch mapCodename={q.data.mapCodename} onPick={setFocus} />}
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
          loading={account.kind === "loading" || (verified && q.isPending)}
          error={q.isError && !q.data}
          data={q.data}
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
