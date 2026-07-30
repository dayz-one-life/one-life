"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { AvatarPanel } from "./avatar-panel";
import type { CropToBlob } from "./avatar-cropper";

/**
 * The avatar edit, as a dialog. Same shell as `ClaimModal` — `z-50` per the LAYER LEGEND at the
 * `<header>` in `components/header.tsx`, dark panel, `useModalBehavior` for focus, Escape and the
 * ref-counted scroll lock.
 *
 * ⚠️ PORTALLED TO `document.body`, which `ClaimModal` does not need to be. This dialog is opened
 * from `StageAvatar`, deep inside the stage section: a `position: fixed` overlay nested under any
 * CSS-transformed ancestor positions against that ancestor's box instead of the viewport and
 * collapses into it. jsdom cannot see the difference, so the portal is pinned by a test rather
 * than by a rendering check.
 *
 * The `mounted` guard is the App Router requirement — `document` does not exist during the server
 * render, and portalling on the first client render before hydration completes mismatches.
 *
 * ⚠️ `onAnnounce` is passed straight through to `AvatarPanel` and NOT rendered here. The live
 * region has to outlive a successful save, which closes (unmounts) this dialog in the same commit
 * — an `SrStatus` owned by this component would suffer the exact defect that moved the region out
 * of `AvatarPanel` in the first place (see the ⚠️ there). Its owner is `StageAvatar`, which stays
 * mounted for as long as the pencil that opens this dialog does.
 *
 * `if (!open) return null` also unmounts `AvatarPanel` on close, not merely hides it — required so
 * a reopen starts from a fresh staged draft and doesn't carry a stale object URL forward.
 */
export function AvatarDialog({
  open,
  onClose,
  onAnnounce,
  cropToBlob,
}: {
  open: boolean;
  onClose: () => void;
  onAnnounce: (message: string) => void;
  cropToBlob?: CropToBlob;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const panelRef = useModalBehavior(open, onClose);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Gesture target, not content (map online-sheet precedent): the dialog is aria-modal. */}
      <div
        aria-hidden="true"
        data-testid="avatar-dialog-backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-ink/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your photo"
        tabIndex={-1}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto border-2 border-dark-line bg-dark shadow-[0_10px_40px_rgba(0,0,0,.5)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center font-mono text-lg text-cream-muted hover:text-paper"
        >
          ✕
        </button>
        <AvatarPanel onSaved={onClose} onAnnounce={onAnnounce} cropToBlob={cropToBlob} />
      </div>
    </div>,
    document.body,
  );
}
