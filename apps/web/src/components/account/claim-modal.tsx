"use client";
import { useEffect, useState } from "react";
import { useAccountStatus } from "@/lib/use-account-status";
import { useControlsActions } from "@/components/account/use-controls";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { claimErrorMessage } from "@/lib/claim-error";
import { LinkTagPanel } from "@/components/account/link-panel";

/**
 * The claim ladder as a dialog (home-consistency spec §3). Hash-driven: every trigger (hero CTA,
 * CTA slab, masthead "Claim your gamertag →") is a plain link to /#claim, so the modal works
 * from any page by navigation and needs no shared open state. Opens ONLY for `unlinked` — the
 * hash is inert for pending (where #claim is the PendingHero scroll anchor) and everyone else.
 *
 * Dismissing CLEARS the hash: a hash left behind would swallow the next CTA click (same-hash
 * clicks fire no hashchange) and reopen the modal on refresh.
 *
 * On a successful claim the status flips unlinked → pending and the gate below closes the modal
 * for free; the pending home renders with its hero where the user already is.
 */
export function ClaimModal() {
  const status = useAccountStatus();
  const a = useControlsActions();

  const [hashOpen, setHashOpen] = useState(false);
  useEffect(() => {
    const check = () => setHashOpen(window.location.hash === "#claim");
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  const open = hashOpen && status.kind === "unlinked";
  const close = () => {
    // replaceState, not `location.hash = ""`: no extra history entry, no scroll jump.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setHashOpen(false);
  };
  const panelRef = useModalBehavior(open, close);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Gesture target, not content (map online-sheet precedent): the dialog is aria-modal. */}
      <div aria-hidden="true" onClick={close} className="absolute inset-0 bg-ink/60" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Link your gamertag"
        tabIndex={-1}
        className="relative w-full max-w-md border-2 border-dark-line bg-dark shadow-[0_10px_40px_rgba(0,0,0,.5)]"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center font-mono text-lg text-cream-muted hover:text-paper"
        >
          ✕
        </button>
        <LinkTagPanel
          pending={a.claim.isPending}
          error={a.claim.isError ? claimErrorMessage(a.claim.error) : null}
          onClaim={(gt) => a.claim.mutate({ gamertag: gt })}
        />
      </div>
    </div>
  );
}
