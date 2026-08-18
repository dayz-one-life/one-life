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
export function ReportBlockMenu({
  gamertag,
  avatarHash,
  claimed,
}: {
  gamertag: string;
  avatarHash: string | null;
  /** Does an account hold this dossier's gamertag? (`PlayerPage.verified`.) Gates Block; see
   *  the `canBlock` comment below.
   *
   *  ⚠️ Named `claimed`, NOT `verified`, and the rename is the point: this prop is about the
   *  DOSSIER SUBJECT, while `status.kind === "verified"` two lines down is about the VIEWER's
   *  own gamertag link. Two different subjects; one word between them was a trap for the next
   *  reader (and had already produced one shipped bug). */
  claimed: boolean;
}) {
  const status = useAccountStatus();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"report" | "block" | null>(null);
  const panelRef = useModalBehavior(open, () => setOpen(false));

  // ⚠️ Signed-out (and still-loading) visitors get nothing to click: both `reportAvatar` and
  // `blockPlayer` 401 without a session, so offering either is a dead end that teaches people
  // the feature is broken. Called after the hooks above so hook order stays stable across
  // renders.
  if (status.kind === "loading" || status.kind === "signedOut") return null;

  // ⚠️ Two different claims, and mixing them up is how this shipped broken. They used to share
  // the word "verified"; the prop is now `claimed` precisely so they cannot be confused again:
  //   • `status.kind === "verified"` — the VIEWER's own gamertag link. `reportAvatar` 403s
  //     `not_verified` without it, so an unlinked/pending viewer never gets Report.
  //   • `claimed` (the prop) — whether anyone has claimed THIS DOSSIER's gamertag.
  //     `blockByGamertag` resolves the target through `verifiedOwnerByGamertag` and 404s
  //     `unknown_gamertag` when nobody has. Most players on the board are unclaimed, so an
  //     ungated Block is an action that fails every single time — the same dead end the
  //     signed-out guard above exists to avoid. The dossier already knows: `ticket-stage.tsx`
  //     prints "unclaimed" from the same field two lines below where it mounts this.
  const canReport = status.kind === "verified" && !!avatarHash;
  const canBlock = claimed;

  // Nothing to offer — render no "..." button rather than a button that opens an empty panel.
  if (!canReport && !canBlock) return null;

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
              reporter's own link is verified. Block names an ACCOUNT, so it only exists when
              some account actually holds this gamertag. */}
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
          {canBlock && (
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
          )}
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
      {canBlock && (
        <BlockDialog open={dialog === "block"} gamertag={gamertag} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
