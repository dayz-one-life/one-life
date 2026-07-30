"use client";
import { useState } from "react";
import { Avatar } from "@/components/shared/avatar";
import { AvatarDialog } from "@/components/account/avatar-dialog";
import { SrStatus } from "@/components/shared/sr-status";

/**
 * The stage's identity circle.
 *
 * Owner: the circle plus a pencil that opens the `AvatarDialog` flow.
 * Public: the same circle, read-only — no pencil, no upload affordance at all.
 *
 * ⚠️ This pencil is the SINGLE edit path. The dossier's old "Update photo ↓" disclosure was
 * retired with it (spec §2) — two edit paths on one page is how the avatar work shipped twice.
 *
 * ⚠️ `SrStatus` lives HERE, not inside `AvatarDialog`/`AvatarPanel`. A successful save calls
 * `onSaved`, which closes (unmounts) the dialog in the same commit that would have set the
 * announcement text — a live region that unmounts alongside its own text change announces
 * nothing. This component outlives the dialog (it stays mounted as long as the pencil does), so
 * the region survives the close and the announcement is actually heard. `onAnnounce` is passed
 * straight through to `AvatarDialog`, which passes it straight through to `AvatarPanel`,
 * unchanged at every hop.
 */
export function StageAvatar({
  hash,
  fallbackInitial,
  editable,
}: {
  hash: string | null;
  fallbackInitial: string;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <div className="relative inline-block flex-none">
        <Avatar hash={hash} size={112} variant="dark" fallbackInitial={fallbackInitial} />
        {editable && (
          <>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-label="Update your photo"
              className="absolute -bottom-1 -right-1 flex h-11 w-11 items-center justify-center rounded-full border-2 border-dark bg-yellow text-dark hover:bg-paper"
            >
              <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <AvatarDialog open={open} onClose={() => setOpen(false)} onAnnounce={setAnnouncement} />
          </>
        )}
      </div>
      {/* Always-mounted (per the SrStatus rule) and a SIBLING of the dialog, not a descendant —
       *  see the ⚠️ above. */}
      <SrStatus>{announcement}</SrStatus>
    </div>
  );
}
