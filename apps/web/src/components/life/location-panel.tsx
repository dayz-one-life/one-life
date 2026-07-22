"use client";
import dynamic from "next/dynamic";
import { useSession } from "@/lib/auth-client";
import { useGamertagLinks } from "@/lib/use-gamertag-links";
import { useLifeTrack } from "@/lib/use-life-track";
import { WithheldBar } from "./timeline";
import { TrackMarkerList } from "./track-marker-list";
// Dynamically imported with ssr:false: only the verified owner of a life ever sees this
// component, which is the overwhelming minority of visitors to a public life-timeline
// page. A static import would ship the TrackMap chunk AND Leaflet's stylesheet to every
// visitor, including every signed-out one. next/dynamic renders its fallback (here, null)
// on the first synchronous pass and resolves the real module asynchronously — callers
// must await the render (see location-panel.test.tsx's "shows the map to the verified
// owner" test) rather than asserting on the first synchronous tick.
const TrackMap = dynamic(() => import("./track-map"), { ssr: false });

interface Props {
  mapSlug: string;
  lifeNumber: number;
  pageGamertag: string;
  alive: boolean;
}

/**
 * Owns the whole owner/withheld/loading/empty/error decision for the location surface.
 *
 * The `isOwner` check here decides only whether to ASK the API. It is bypassable from
 * devtools and is not the gate — the /me route derives the subject from the session
 * cookie. See the spec §3.7.
 */
export function isOwnerOf(
  signedIn: boolean,
  links: { gamertag: string; status: string }[] | undefined,
  pageGamertag: string,
): boolean {
  return signedIn && (links ?? []).some(
    (l) => l.status === "verified" && l.gamertag.toLowerCase() === pageGamertag.toLowerCase(),
  );
}

export function LocationPanel({ mapSlug, lifeNumber, pageGamertag, alive }: Props) {
  const { data: session } = useSession();
  const { data: links } = useGamertagLinks(!!session?.user);
  const isOwner = isOwnerOf(!!session?.user, links, pageGamertag);

  const { data: track, isPending, isError } = useLifeTrack(mapSlug, lifeNumber, isOwner, alive);

  // Non-owners get exactly today's DOM: the bar on an alive life, nothing on a dead one.
  if (!isOwner) return alive ? <WithheldBar /> : null;

  if (isPending) {
    return (
      <p className="mt-5 border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-ink-soft">
        Pulling your fixes…
      </p>
    );
  }

  // A failed fetch and an empty desk are different statements and must never collapse
  // into one another (the live-data-honesty settleFeed rule).
  if (isError) {
    return (
      <p role="status" className="mt-5 border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-red-deep">
        Couldn&apos;t load your position record. This is a fault at the desk, not an empty file.
      </p>
    );
  }

  // `useLifeTrack` resolves a 403 to `null` on purpose — that is the server successfully
  // telling us we are not the owner, not a fault. The client-side `isOwner` guess above
  // already got this wrong once (stale link cache, race), so this is a real, reachable
  // branch, and it must say something true, not reuse the desk-fault line above.
  if (!track) {
    return (
      <p className="mt-5 border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-ink-soft">
        The desk will not release this record to you.
      </p>
    );
  }

  return (
    <section className="mt-5 border border-ink">
      <h2 className="border-b border-ink bg-bone px-4 py-2 font-display text-xs font-bold uppercase tracking-[.1em] text-ink">
        Desk copy — for your eyes only
      </h2>
      <div className="p-4">
        {track.sampleCount === 0 ? (
          <p className="font-mono text-[11px] text-ink-soft">
            No fixes recorded for this life.
          </p>
        ) : (
          <>
            <TrackMap track={track} />
            <TrackMarkerList markers={track.markers} />
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[.08em] text-ink-muted">
              {track.sampleCount} fixes{track.truncated ? " · trail truncated" : ""} · every marker approximate
            </p>
          </>
        )}
      </div>
    </section>
  );
}
