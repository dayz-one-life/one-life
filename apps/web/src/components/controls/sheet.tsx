"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { useSheetDrag } from "@/lib/use-sheet-drag";
import { banCountdown, mapLabel } from "@/components/player/format";
import { unbanStateOf, type UnbanState } from "@/components/player/self-unban-button";
import { SkewCta } from "@/components/tabloid/skew-cta";
import { serverFactLine, type ServerCardData } from "./format";
import { StateChip } from "./server-cards";

type Phase = "closed" | "enter" | "open" | "closing";

/** Bottom sheet chrome (canvas 10c): overlay + dark panel with a real swipe-dismiss handle.
 *  Open/close runs a two-phase transform transition (250ms in / 160ms out, motion-safe);
 *  reduced motion keeps the old instant mount/unmount. Any route change dismisses the sheet
 *  so a tapped link can never leave chrome over its destination. */
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
  const [phase, setPhase] = useState<Phase>("closed");
  const mounted = phase !== "closed";
  const panelRef = useModalBehavior(mounted, onClose);
  useSheetDrag(panelRef, onClose, phase === "open");

  // Enter: mount offscreen, slide up next frame. Close: play the exit, unless reduced
  // motion wants it instant (a 400ms zombie panel is worse than no animation).
  useEffect(() => {
    if (open) {
      setPhase((p) => (p === "closed" || p === "closing" ? "enter" : p));
      const raf = requestAnimationFrame(() => setPhase((p) => (p === "enter" ? "open" : p)));
      return () => cancelAnimationFrame(raf);
    }
    setPhase((p) => {
      if (p === "closed") return p;
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "closed" : "closing";
    });
  }, [open]);

  // Safety net: closing must always reach closed even if transitionend never fires.
  useEffect(() => {
    if (phase !== "closing") return;
    const t = setTimeout(() => setPhase("closed"), 400);
    return () => clearTimeout(t);
  }, [phase]);

  // Navigate-under-chrome bug class: any navigation from inside the sheet dismisses it.
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      if (open) onClose();
    }
  }, [pathname, open, onClose]);

  if (!mounted) return null;
  const out = phase === "enter" || phase === "closing";
  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-dark/55 motion-safe:transition-opacity motion-safe:duration-200",
          out ? "opacity-0" : "opacity-100",
        )}
      />
      <div
        id="controls-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Player controls"
        ref={panelRef}
        tabIndex={-1}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && phase === "closing") setPhase("closed");
        }}
        className={cn(
          "absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto border-t-[3px] border-red bg-dark shadow-[0_-18px_40px_rgba(0,0,0,.45)]",
          "motion-safe:transition-transform",
          phase === "closing"
            ? "motion-safe:duration-[160ms] motion-safe:ease-in"
            : "motion-safe:duration-[250ms] motion-safe:ease-out",
          out ? "translate-y-full" : "translate-y-0",
        )}
      >
        <div data-sheet-drag-zone className="cursor-grab touch-none">
          <div aria-hidden className="mx-auto mt-2.5 h-1 w-11 rounded-sm bg-dark-edge" />
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
        </div>
        <div className="flex flex-col gap-3 px-[18px] pb-[calc(20px+env(safe-area-inset-bottom))] pt-3.5">
          {children}
        </div>
      </div>
    </div>
  );
}

function SheetUnban({ state, onRedeem }: { state: UnbanState; onRedeem: () => void }) {
  if (state === "hidden") return null;
  if (state === "pending") {
    return <p className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-cream-dim">Unban pending — lifting shortly…</p>;
  }
  if (state === "no-tokens") {
    return (
      <p className="mt-2 border border-dashed border-dark-edge px-2.5 py-1.5 text-center font-mono text-[11px] uppercase tracking-[.05em] text-red-soft">
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
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] uppercase tracking-[.03em] text-cream-muted">
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
            <div className="mt-2 flex items-center justify-between border border-dark-line bg-dark-well px-2.5 py-1.5">
              <span className="font-mono text-[12px] uppercase tracking-[.06em] text-cream-muted">Ban lifts in</span>
              <span className="font-display text-base font-bold tabular-nums text-paper">{countdown}</span>
            </div>
          )}
          <SheetUnban state={unbanStateOf(card.ban!.liftPending || redeeming, balance)} onRedeem={() => onRedeem(card.ban!.banId)} />
        </>
      )}
    </section>
  );
}
