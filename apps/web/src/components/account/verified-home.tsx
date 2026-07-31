"use client";
import { useQuery } from "@tanstack/react-query";
import { getPlayerPage } from "@/lib/api";
import { playerSlug } from "@/lib/slug";
import { TicketStage, StageSkeleton } from "@/components/player/ticket-stage";
import { Morgue } from "@/components/player/morgue";
import { JoinServers } from "@/components/front-page/join-servers";
import { ControlsSlab } from "./controls-slab";

/**
 * How many ticket boxes the loading stage holds open when the fleet list has NOT resolved yet.
 * ⚠️ Not a statement about the fleet — see `StageSkeleton`'s note. It is the size of an empty
 * box, chosen because it is the fleet's size today; a fourth server makes the reservation one
 * box short for the first paint of a cold cache and nothing else.
 */
export const FALLBACK_TICKET_SLOTS = 3;

/**
 * The verified player's home: the same stage the public dossier renders, plus the controls the
 * owner alone gets, plus their own morgue.
 *
 * ⚠️ The stage and the morgue read from ONE `player-page` query but degrade INDEPENDENTLY: the
 * morgue is driven by its own `state` prop, so a failed fetch renders "couldn't load" there
 * while the stage renders its own placeholder — and neither is ever allowed to bottom out into an
 * authoritative empty. The controls slab has its own queries entirely, so a dead player-page
 * fetch never takes the invite link and the balance down with it.
 *
 * ⚠️ The connect beat is `JoinServers` — the SAME yellow slab the cold home, the unverified pitch
 * and the pending home render. It used to be the older text-only `HowToConnect` panel here alone,
 * which is exactly the drift the universal beat exists to prevent. This is now the only connect
 * block in the app; there is no second one to fall back to.
 */
export function VerifiedHome({ gamertag, ticketSlots }: {
  gamertag: string;
  /** How many ticket-shaped boxes the loading stage holds open. Passed down from the already-
   *  running `servers` query so the reservation matches the real fleet whenever that has
   *  resolved; `StageSkeleton` supplies its own floor when it has not. */
  ticketSlots?: number;
}) {
  const slug = playerSlug(gamertag);
  const player = useQuery({
    queryKey: ["player-page", gamertag],
    queryFn: () => getPlayerPage(slug),
    refetchInterval: 60_000, // ban countdowns tick once a minute
  });
  const now = new Date();
  const page = player.data ?? null;
  // ⚠️ Only offered when the player actually has somewhere to spawn. A player alive or banned
  // everywhere needs no connect instructions, and an UNRESOLVED standing is not an idle one —
  // `page` must exist before this can claim either way.
  const anyIdle = page?.standing.some((s) => s.state === "idle") ?? false;

  return (
    <div className="flex flex-col">
      {page ? (
        <TicketStage page={page} viewer="owner" now={now} />
      ) : (
        // ⚠️ This placeholder used to be the section chrome around a single line of text — about
        // 150px where the resolved stage is 580px and, on a phone, three times that. The whole
        // page below it (slab, morgue, footer) was laid out against that stub and then shoved
        // down when the fetch landed: one 0.669 layout shift, measured on production, against a
        // 0.1 "good" budget. It reserves the real geometry now.
        <StageSkeleton
          slots={ticketSlots ?? FALLBACK_TICKET_SLOTS}
          live={!player.isError}
          message={player.isError ? "Couldn't load your standing just now." : "Reading your file…"}
        />
      )}

      <ControlsSlab />

      {/* ⚠️ NO margin between the slab and this beat. Both state their own heavy rule — the slab
       *  ends `border-b-2 border-ink`, `JoinServers` opens `border-t-4 border-ink` — so a gap
       *  here rendered as two separate lines with a strip of page background trapped between
       *  them. Butted, they read as one rule and the page reads as continuous slabs. */}
      {anyIdle && (
        <div id="connect">
          <JoinServers />
        </div>
      )}

      <Morgue
        entries={page?.obituaries ?? []}
        total={page?.obituariesTotal ?? 0}
        viewer="owner"
        state={page ? "ready" : player.isError ? "failed" : "loading"}
        playerSlug={slug}
        now={now}
      />
    </div>
  );
}
