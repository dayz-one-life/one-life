"use client";
import { useState } from "react";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { OnlineList } from "./online-list";
import type { FriendPositionDto, OnlinePlayerDto } from "@/lib/types";

/** Who is online on this map, on demand.
 *
 *  This is the ONLY home of `OnlineList` now that the map fills the viewport — and the list is
 *  the screen-reader companion to a canvas with no text, so it must stay reachable by a real
 *  button in the tab order rather than becoming decoration behind a hover. */
export function FriendsPanel({ players, positions, now, loading, error, onShare, onStopSharing, pendingFor }: {
  players: OnlinePlayerDto[] | undefined;
  /** Fixes for sharing players — passed through to OnlineList so the accessible rows can carry
   *  a fix age, not just the mouse-driven map popup. */
  positions?: FriendPositionDto[];
  now?: Date;
  loading: boolean;
  /** A FAILED fetch. Distinct from loading and from a genuinely empty map — rendering it as
   *  "nobody is online" is a claim about the game made from a network error. */
  error?: boolean;
  /** Grant controls, passed straight through to OnlineList. Absent ⇒ no controls. */
  onShare?: (gamertag: string) => void;
  onStopSharing?: (gamertag: string) => void;
  pendingFor?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  // Loading is not zero. Until the payload lands, the button carries no count at all.
  // The count is everyone online INCLUDING the viewer: it has to agree with the list directly
  // beneath it and with the server's own player count, and excluding yourself buys nothing —
  // you know whether you are playing.
  const count = loading || !players ? null : players.length;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        // ⚠️ DARK SURFACE — paper/cream tokens, never ink. The solid bg-dark/90 is load-bearing:
        // this button floats over PALE terrain tiles, where a borderless-transparent control is
        // paper-on-bone — present, functional, invisible (the map-in-shell mock backs every
        // overlay control with rgba(12,12,8,.92) for exactly this reason).
        className="flex min-h-[52px] min-w-[52px] items-center justify-center gap-1.5 border border-dark-edge bg-dark/90 px-4 py-1.5 font-mono text-[15px] uppercase tracking-[.05em] text-paper md:min-h-[40px] md:min-w-[40px] md:px-3 md:text-[13px]"
      >
        <span aria-hidden>☰</span>
        {/* "Online" — not "Friends": the panel lists every player on the server, friends first,
            and the count is players online, not friends sharing. "Friends" here would be the
            same class of lie the presence-switch copy was fixed for above. */}
        <span className="hidden md:inline">Online</span>
        {count !== null && <span>{count}</span>}
        {/* The visible label collapses to an icon below md, so the accessible name must not. */}
        <span className="sr-only md:hidden">Online{count !== null ? ` ${count}` : ""}</span>
      </button>
      {open && (
        <>
          {/* ⚠️ THE WAY OUT ON A TOUCH DEVICE. Below `md` the sheet is fixed and there is no
              Escape key. This backdrop and the Close button below are exits and both must stay —
              but per the map-in-shell mock, BOTH stop above the TabBar: the sheet opens over the
              map, never over the bar that holds the way to leave the page, so the tabs stay
              tappable throughout. `aria-hidden` + no role: it is a gesture target, not content —
              the dialog is `aria-modal` so AT already ignores what is behind it. Same z-50
              overlay altitude as the sheet, painted under it by DOM order, so this adds no
              fourth altitude to the LAYER LEGEND. */}
          <div
            aria-hidden
            data-testid="online-backdrop"
            onClick={() => setOpen(false)}
            className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] top-0 z-50 md:hidden"
          />
          {/* z-50 is the overlay altitude (LAYER LEGEND, components/header.tsx) — above the
              z-40 bar this hangs from. A bottom sheet on a phone (stopping above the TabBar's
              4rem + safe-area row); from `md` up an anchored panel that opens UPWARD —
              `bottom-full`, because the trigger sits at the bottom edge of the map, where a
              `top-full` panel renders off the bottom of the page (shipped that way once). */}
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            // Load-bearing: useModalBehavior calls panelRef.current?.focus(), which is a silent
            // no-op on a div with no tabindex — the sheet would open with focus left behind.
            tabIndex={-1}
            aria-label="Who is online on this map"
            className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 max-h-[60dvh] overflow-y-auto border-y border-dark-edge bg-dark-well p-4 md:absolute md:inset-x-auto md:bottom-full md:right-0 md:mb-1 md:w-80 md:border"
          >
            <div className="mb-2 flex items-center justify-between gap-3 border-b border-dark-edge pb-2">
              <span className="font-mono text-[11px] uppercase tracking-[.08em] text-cream-muted">
                Online
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex min-h-[52px] min-w-[52px] items-center justify-center font-mono text-[19px] text-paper md:min-h-0 md:min-w-0 md:text-[13px]"
              >
                <span aria-hidden>✕</span>
                <span className="sr-only">Close</span>
              </button>
            </div>
            {/* OnlineList already carries cream/paper tokens — the map shell is dark end to
                end, so there is no light variant of it to swap to. */}
            {error ? (
              <p role="status" className="font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted">
                Couldn&apos;t load who is online.
              </p>
            ) : loading ? (
              <p role="status" className="font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted">
                Loading…
              </p>
            ) : (
              <OnlineList
                players={players ?? []}
                positions={positions}
                now={now}
                onShare={onShare}
                onStopSharing={onStopSharing}
                pendingFor={pendingFor}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
