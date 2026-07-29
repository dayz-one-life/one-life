"use client";
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

// ⚠️ The scroll lock is REF-COUNTED, not saved per consumer. Two consumers can be open at once
// (the masthead account menu opens the claim modal from inside itself), and a per-consumer
// save/restore has the second one capture the first's "hidden" and put it back on the way out —
// leaving the page locked with no dialog on screen. Only the first lock saves, only the last
// unlock restores.
let lockCount = 0;
let savedOverflow = "";

function lockScroll(): void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
}

function unlockScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = savedOverflow;
}

/**
 * Shared dialog behavior for full-screen overlays (mobile menu, controls sheet):
 * focus moves into the panel on open and back to the opener on close; Escape
 * closes; Tab cycles inside; body scroll is locked while open.
 */
export function useModalBehavior(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Inline arrows at call sites (e.g. `() => setOpen(false)`) get a new identity
  // every render; keep the latest onClose in a ref so the main effect depends
  // only on `open` — otherwise every parent re-render while open re-fires the
  // effect and yanks focus back onto the panel.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    lockScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockScroll();
      restoreRef.current?.focus();
    };
  }, [open]);

  return panelRef;
}
