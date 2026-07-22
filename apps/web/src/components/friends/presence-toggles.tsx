"use client";

const LABEL = "font-mono text-[11px] uppercase tracking-[.05em] text-ink flex items-center gap-1.5";
const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted";

/** The per-user master switch. Off by default — nobody is visible until they opt in. */
export function MasterShareSwitch(p: {
  on: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className={`${LABEL} border-b border-hairline pb-2.5`}>
      <input
        type="checkbox"
        checked={p.on}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.checked)}
      />
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
  return (
    <div className="flex flex-col gap-1 py-1">
      <label className={LABEL}>
        <input
          type="checkbox"
          checked={p.share}
          disabled={p.disabled || !p.masterOn}
          onChange={(e) => p.onChange({ share: e.target.checked })}
          aria-describedby={p.masterOn ? undefined : noteId}
        />
        Share my status
      </label>
      {p.masterOn ? null : <span className={NOTE} id={noteId}>Sharing is off for everyone</span>}
      <label className={LABEL}>
        <input
          type="checkbox"
          checked={p.notify}
          disabled={p.disabled}
          onChange={(e) => p.onChange({ notify: e.target.checked })}
        />
        Notify me
      </label>
    </div>
  );
}
