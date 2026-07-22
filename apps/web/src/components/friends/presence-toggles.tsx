"use client";

const LABEL = "font-mono text-[11px] uppercase tracking-[.05em] text-ink flex items-center gap-2";
const LABEL_DISABLED = "text-ink-muted";
const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted";

/**
 * A tabloid-styled checkbox. The native `<input type="checkbox">` stays in the DOM (sr-only,
 * not `display:none`) so it keeps its role, accessible name, focus order, keyboard operability
 * and `aria-describedby` — only its default browser chrome is hidden. A sibling box + checkmark
 * pair (`peer-*` variants track the real input's state) render the visible control, so state is
 * carried by fill AND a checkmark glyph, never by colour alone.
 */
function Box(p: {
  checked: boolean;
  disabled?: boolean;
  ariaDescribedby?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={p.checked}
        disabled={p.disabled}
        aria-describedby={p.ariaDescribedby}
        onChange={(e) => p.onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 border border-ink bg-paper peer-checked:bg-ink
          peer-focus-visible:outline peer-focus-visible:outline-2
          peer-focus-visible:outline-offset-2 peer-focus-visible:outline-red
          peer-disabled:border-ink-muted peer-disabled:opacity-50"
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 8 8"
        className="relative hidden h-2 w-2 text-paper peer-checked:block"
      >
        <path d="M1 4.2 L3.1 6.2 L7 1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

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
