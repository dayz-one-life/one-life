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
