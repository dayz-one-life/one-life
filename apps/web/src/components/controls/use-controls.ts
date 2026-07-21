"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountStatus } from "@/lib/use-account-status";
import { useCancelLink, useClaimGamertag } from "@/lib/use-gamertag-links";
import { getMe, getPlayerPage, getServers, getTokens, redeemToken, setReferrer, transferToken } from "@/lib/api";
import { playerSlug } from "@/lib/slug";
import type { AccountStatus } from "@/lib/account-status";
import type { Server, ServerStanding } from "@/lib/types";

export type Controls = {
  status: AccountStatus;
  name: string | null;
  provider: string | null;
  balance: number | null;
  servers: Server[];
  standing: ServerStanding[];
  /**
   * True while the standing behind `standing` is unresolved (loading or errored) for a
   * verified user. `standing` itself stays `[]` in this case for backward compatibility, but
   * `[]` is ALSO the genuinely-resolved "no life anywhere" shape — a consumer must check this
   * flag before rendering per-server "idle" state, or it fabricates idle from an unknown
   * (spec: live-data honesty §5).
   */
  standingLoading: boolean;
  /**
   * True while the balance behind `balance` is unresolved (loading or errored) for a signed-in
   * user. `balance` itself stays `null` in this case (see below) — a consumer must check this
   * flag before treating `balance ?? 0` as a resolved fact, or it fabricates a "0" balance (and,
   * transitively, a "no unban tokens" CTA) from an unknown state (spec: live-data honesty §5).
   */
  balanceLoading: boolean;
};

/** One data source for all three control surfaces (rail, pill, sheet). */
export function useControls(): Controls {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const me = useQuery({ queryKey: ["me"], queryFn: getMe, enabled: signedIn, staleTime: 60_000 });
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: getTokens, enabled: signedIn });
  const servers = useQuery({ queryKey: ["servers"], queryFn: getServers, enabled: signedIn, staleTime: 5 * 60_000 });
  const gamertag = status.kind === "verified" ? status.link.gamertag : null;
  const player = useQuery({
    queryKey: ["player-page", gamertag],
    queryFn: () => getPlayerPage(playerSlug(gamertag!)),
    enabled: gamertag !== null,
    refetchInterval: 60_000, // ban countdowns tick once a minute
  });
  return {
    status,
    name: me.data?.user.name || me.data?.user.email?.split("@")[0] || null,
    provider: me.data?.accounts[0]?.providerId ?? null,
    balance: tokens.data?.balance ?? null,
    servers: servers.data ?? [],
    standing: player.data?.standing ?? [],
    standingLoading: gamertag !== null && (player.isLoading || player.isError),
    // Mirrors the tokens query's own `enabled` predicate above (`signedIn`), the same way
    // `standingLoading` mirrors the player-page query's `gamertag !== null`.
    balanceLoading: signedIn && (tokens.isLoading || tokens.isError),
  };
}

/** The mutations behind the rail/sheet controls, shared so both surfaces stay in sync. */
export function useControlsActions() {
  const qc = useQueryClient();
  const claim = useClaimGamertag();
  const cancel = useCancelLink();
  const send = useMutation({
    mutationFn: (gt: string) => transferToken(gt),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tokens"] }),
  });
  const refer = useMutation({ mutationFn: (gt: string) => setReferrer(gt) });
  const redeem = useMutation({
    mutationFn: (banId: number) => redeemToken(banId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tokens"] });
      void qc.invalidateQueries({ queryKey: ["player-page"] });
    },
  });
  return { claim, cancel, send, refer, redeem };
}
