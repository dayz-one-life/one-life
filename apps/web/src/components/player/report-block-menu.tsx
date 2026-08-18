"use client";

import { useState } from "react";
import { useAccountStatus } from "@/lib/use-account-status";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { BlockDialog } from "@/components/moderation/block-dialog";

/**
 * The dossier's "..." affordance for a stranger's page: Report the avatar (if there is one) and
 * Block the player. Never rendered on your own dossier — `ticket-stage.tsx` only mounts this
 * when `!owner`.
 */
export function ReportBlockMenu({ gamertag, avatarHash }: { gamertag: string; avatarHash: string | null }) {
  const status = useAccountStatus();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"report" | "block" | null>(null);
  const panelRef = useModalBehavior(open, () => setOpen(false));

  // ⚠️ Signed-out (and still-loading) visitors get nothing to click: both `reportAvatar` and
  // `blockPlayer` 401 without a session, so offering either is a dead end that teaches people
  // the feature is broken. Called after the hooks above so hook order stays stable across
  // renders.
  if (status.kind === "loading" || status.kind === "signedOut") return null;

  // ⚠️ `reportAvatar` 403s server-side (`not_verified`) unless the reporter's gamertag link is
  // VERIFIED — `blockPlayer` only requires being signed in. An unlinked/pending viewer therefore
  // still gets Block, but never a Report item that would just fail.
  const canReport = status.kind === "verified" && !!avatarHash;

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-xs uppercase tracking-[.04em] text-cream-muted"
        aria-label={`Actions for ${gamertag}`}
      >
        &#8943;
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={`Actions for ${gamertag}`}
          // ⚠️ `tabIndex={-1}` is required, not decorative: `useModalBehavior` calls
          // `panelRef.current?.focus()` on open, and focusing a div with no tabindex is a silent
          // no-op — same shipped-bug guard as `shell/nav-menu.tsx`.
          tabIndex={-1}
          className="border border-ink bg-paper p-1"
        >
          {/* Report names BYTES, so it only exists when there are bytes to report and the
              reporter's own link is verified. Block names a person, who exists whether or not
              they uploaded anything, and is offered to any signed-in viewer. */}
          {canReport && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDialog("report");
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left font-mono text-xs uppercase"
            >
              Report avatar
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDialog("block");
              setOpen(false);
            }}
            className="block w-full px-3 py-2 text-left font-mono text-xs uppercase"
          >
            Block player
          </button>
        </div>
      )}
      {avatarHash && (
        <ReportDialog
          open={dialog === "report"}
          gamertag={gamertag}
          avatarHash={avatarHash}
          onClose={() => setDialog(null)}
        />
      )}
      <BlockDialog open={dialog === "block"} gamertag={gamertag} onClose={() => setDialog(null)} />
    </>
  );
}
