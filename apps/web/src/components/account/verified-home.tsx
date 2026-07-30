"use client";
import { useQuery } from "@tanstack/react-query";
import { getPlayerPage } from "@/lib/api";
import { playerSlug } from "@/lib/slug";
import { TicketStage } from "@/components/player/ticket-stage";
import { Morgue } from "@/components/player/morgue";
import { JoinServers } from "@/components/front-page/join-servers";
import { ControlsSlab } from "./controls-slab";

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
export function VerifiedHome({ gamertag }: { gamertag: string }) {
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
        <section
          {...(player.isError ? {} : { role: "status" })}
          className="border-b-[6px] border-red bg-dark px-6 py-12 text-paper md:px-10 md:py-16"
        >
          <p className="font-mono text-xs uppercase tracking-[.28em] text-cream-dim">
            {player.isError ? "Couldn't load your standing just now." : "Reading your file…"}
          </p>
        </section>
      )}

      <ControlsSlab />

      {anyIdle && (
        <div id="connect" className="mt-8">
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
