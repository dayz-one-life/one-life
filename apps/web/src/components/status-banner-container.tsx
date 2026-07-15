"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import { useCancelLink, useClaimGamertag } from "@/lib/use-gamertag-links";
import { StatusBanner } from "./status-banner";

export function StatusBannerContainer() {
  const status = useAccountStatus();
  const cancel = useCancelLink();
  const claim = useClaimGamertag();
  const active = status.kind === "pending" ? status.link : null;
  return (
    <StatusBanner
      status={status}
      onCancel={() => active && cancel.mutate(active.id)}
      onReclaim={() => active && claim.mutate({ gamertag: active.gamertag })}
      canceling={cancel.isPending}
      reclaiming={claim.isPending}
    />
  );
}
