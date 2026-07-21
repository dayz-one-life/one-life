import type { ReactNode } from "react";

/**
 * Visually-hidden `role="status" aria-live="polite"` announcer for DOM changes that result
 * from a user action or a background poll and are not accompanied by a focus move — the
 * polite counterpart to the `role="alert"` (assertive) error nodes already in the four forms.
 * Render it unconditionally (never mount/unmount it around the message) so the live region
 * is already present in the DOM before its text changes — some screen readers only announce
 * mutations to a region that existed at the time of the change.
 */
export function SrStatus({ children }: { children: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {children}
    </p>
  );
}
