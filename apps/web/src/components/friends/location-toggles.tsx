"use client";
import { Box, LABEL, LABEL_DISABLED, NOTE } from "./checkbox";

/**
 * ⚠️ DELIBERATELY UNDIFFERENTIATED. A friend's location being invisible to you has two causes —
 * their master switch is off, or they have hidden from you specifically — and this must never
 * distinguish them. Differentiating would tell one player that a named friend singled them out,
 * which makes the per-friend hide switch a visible act and therefore unusable. See F2 spec §5.3.
 *
 * The caller passes a single already-collapsed boolean (`theyShareLocation` from the API), so
 * the distinction is not merely unrendered — it never reaches the client.
 */
export function reciprocityLabel(theyShare: boolean): string {
  return theyShare ? "Sharing with you" : "Not sharing with you";
}

/** The per-user master switch for location. Separate from the presence one: "I'm online" is a
 *  social signal, "I'm at these coordinates" is tactical. */
export function MasterLocationSwitch(p: {
  on: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`${LABEL} border-b border-hairline pb-2.5 ${p.disabled ? LABEL_DISABLED : ""} ${p.disabled ? "" : "cursor-pointer"}`}
    >
      <Box checked={p.on} disabled={p.disabled} onChange={p.onChange} />
      Share my location with friends
    </label>
  );
}

/** Per-friend location control plus the reciprocity line. */
export function LocationToggle(p: {
  /** Used only to derive a unique id for the disabled note, so N rows never collide on one
   *  DOM id and every row's `aria-describedby` resolves to its own note. */
  friendshipId: number;
  share: boolean;
  masterOn: boolean;
  theyShare: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const noteId = `location-disabled-${p.friendshipId}`;
  const shareDisabled = p.disabled || !p.masterOn;
  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <label className={`${LABEL} ${shareDisabled ? LABEL_DISABLED : "cursor-pointer"}`}>
        <Box
          checked={p.share}
          disabled={shareDisabled}
          ariaDescribedby={p.masterOn ? undefined : noteId}
          onChange={p.onChange}
        />
        Share my location
      </label>
      {p.masterOn ? null : (
        <span className={NOTE} id={noteId}>Location sharing is off for everyone</span>
      )}
      <span className={NOTE}>{reciprocityLabel(p.theyShare)}</span>
    </div>
  );
}
