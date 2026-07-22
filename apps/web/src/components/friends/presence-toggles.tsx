"use client";
import { Box, LABEL, LABEL_DISABLED, NOTE } from "./checkbox";

/** The per-user master switch. Off by default — nobody is visible until they opt in. */
export function MasterShareSwitch(p: {
  on: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`${LABEL} border-b border-hairline pb-2.5 ${p.disabled ? LABEL_DISABLED : ""} cursor-pointer`}
    >
      <Box checked={p.on} disabled={p.disabled} onChange={p.onChange} />
      Share my status with friends
    </label>
  );
}

/**
 * Per-friend presence controls.
 *
 * `share` is gated by the master switch: with the master off, the control is DISABLED and
 * annotated rather than hidden, so the two levels are visible instead of mysterious.
 * `notify` is independent of it — muting a friend is meaningful whether or not you are
 * visible yourself.
 */
export function PresenceToggles(p: {
  /** The friendship id this row belongs to — used only to derive a unique id for the
   *  disabled-share note (`share-disabled-${friendshipId}`), so N rows rendered together
   *  never collide on one DOM id and every row's `aria-describedby` resolves to its own note. */
  friendshipId: number;
  share: boolean;
  notify: boolean;
  masterOn: boolean;
  disabled?: boolean;
  onChange: (patch: { share?: boolean; notify?: boolean }) => void;
}) {
  const noteId = `share-disabled-${p.friendshipId}`;
  const shareDisabled = p.disabled || !p.masterOn;
  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <label className={`${LABEL} ${shareDisabled ? LABEL_DISABLED : "cursor-pointer"}`}>
        <Box
          checked={p.share}
          disabled={shareDisabled}
          ariaDescribedby={p.masterOn ? undefined : noteId}
          onChange={(v) => p.onChange({ share: v })}
        />
        Share my status
      </label>
      {p.masterOn ? null : <span className={NOTE} id={noteId}>Sharing is off for everyone</span>}
      <label className={`${LABEL} ${p.disabled ? LABEL_DISABLED : "cursor-pointer"}`}>
        <Box
          checked={p.notify}
          disabled={p.disabled}
          onChange={(v) => p.onChange({ notify: v })}
        />
        Notify me
      </label>
    </div>
  );
}
