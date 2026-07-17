"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { banCountdown, mapLabel } from "@/components/player/format";
import { unbanStateOf, type UnbanState } from "@/components/player/self-unban-button";
import { SkewCta } from "@/components/tabloid/skew-cta";
import { serverFactLine, type ServerCardData } from "./format";
import { StateChip } from "./server-cards";

/** Bottom sheet chrome (canvas 10c): overlay + dark panel with drag handle and close. */
export function ControlsSheet({
  open,
  onClose,
  header,
  children,
}: {
  open: boolean;
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useModalBehavior(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <div aria-hidden className="absolute inset-0 bg-dark/55" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Player controls"
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto border-t-[3px] border-red bg-dark shadow-[0_-18px_40px_rgba(0,0,0,.45)]"
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-11 rounded-sm bg-[#4A4838]" />
        <div className="flex items-center gap-3 border-b border-dark-line px-[18px] py-3">
          <div className="min-w-0 flex-1">{header}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close controls"
            className="flex h-11 w-11 flex-none items-center justify-center text-2xl leading-none text-cream-muted hover:text-paper"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
        <div className="flex flex-col gap-3 px-[18px] pb-5 pt-3.5">{children}</div>
      </div>
    </div>
  );
}

function SheetUnban({ state, onRedeem }: { state: UnbanState; onRedeem: () => void }) {
  if (state === "hidden") return null;
  if (state === "pending") {
    return <p className="mt-2 font-mono text-[10px] uppercase tracking-[.05em] text-cream-dim">Unban pending — lifting shortly…</p>;
  }
  if (state === "no-tokens") {
    return (
      <p className="mt-2 border border-dashed border-[#4A4838] px-2.5 py-1.5 text-center font-mono text-[10px] uppercase tracking-[.05em] text-red-soft">
        No unban tokens
      </p>
    );
  }
  return (
    <div className="mt-2">
      <SkewCta onClick={onRedeem}>Spend 1 token — skip the wait</SkewCta>
    </div>
  );
}

/** Dark-compact server row for the sheet (canvas 10c). */
export function SheetServerRow({
  card,
  ownSlug,
  balance,
  now,
  onRedeem,
  redeeming,
}: {
  card: ServerCardData;
  ownSlug: string | null;
  balance: number;
  now: Date;
  onRedeem: (banId: number) => void;
  redeeming: boolean;
}) {
  const banned = card.state === "banned" && card.ban !== null;
  const countdown = banned ? banCountdown(card.ban!.expiresAt, now) : null;
  return (
    <section className={cn("border border-dark-line px-3.5 py-3", banned && "border-l-[3px] border-l-red")}>
      <div className="flex items-center gap-2.5">
        <h3 className="flex-none font-display text-sm font-semibold uppercase leading-none text-paper">{mapLabel(card.map)}</h3>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[.03em] text-cream-muted">
          {serverFactLine(card)}
          {banned && ownSlug && (
            <>
              {" · "}
              <Link href={`/players/${ownSlug}`} className="text-red-soft">Obit →</Link>
            </>
          )}
        </span>
        <StateChip state={card.state} small />
      </div>
      {banned && (
        <>
          {countdown && (
            <div className="mt-2 flex items-center justify-between border border-dark-line bg-[#111] px-2.5 py-1.5">
              <span className="font-mono text-[9.5px] uppercase tracking-[.06em] text-cream-muted">Ban lifts in</span>
              <span className="font-display text-base font-bold text-paper">{countdown}</span>
            </div>
          )}
          <SheetUnban state={unbanStateOf(card.ban!.liftPending || redeeming, balance)} onRedeem={() => onRedeem(card.ban!.banId)} />
        </>
      )}
    </section>
  );
}
