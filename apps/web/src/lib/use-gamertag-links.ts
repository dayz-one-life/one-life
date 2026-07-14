"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getGamertagLinks, getGamertagLink, claimGamertag, cancelGamertagLink } from "./api";
import { hasPendingLink } from "./account-status";

export function useGamertagLinks(enabled = true) {
  return useQuery({
    queryKey: ["gamertag-links"],
    queryFn: getGamertagLinks,
    enabled,
    // Poll while a link is pending so the banner's emote progress ticks live and
    // flips to verified on completion; stops once nothing is pending.
    refetchInterval: (q) => (hasPendingLink(q.state.data) ? 5000 : false),
  });
}

export function useClaimGamertag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ gamertag }: { gamertag: string }) => claimGamertag(gamertag),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gamertag-links"] }),
  });
}

export function useCancelLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => cancelGamertagLink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gamertag-links"] }),
  });
}

export function useLinkStatus(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ["gamertag-link", id],
    queryFn: () => getGamertagLink(id),
    enabled,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 2000 : false),
  });
}
