"use client";

export const LABEL = "font-mono text-[11px] uppercase tracking-[.05em] text-ink flex items-center gap-2";
export const LABEL_DISABLED = "text-ink-muted";
export const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted";

/**
 * A tabloid-styled checkbox. The native `<input type="checkbox">` stays in the DOM (sr-only,
 * not `display:none`) so it keeps its role, accessible name, focus order, keyboard operability
 * and `aria-describedby` — only its default browser chrome is hidden. A sibling box + checkmark
 * pair (`peer-*` variants track the real input's state) render the visible control, so state is
 * carried by fill AND a checkmark glyph, never by colour alone.
 */
export function Box(p: {
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
      {/* The checkmark carries `peer-disabled:opacity-50` to MATCH the box above it. Without
          it, a disabled+checked control renders a full-opacity checkmark over a half-opacity
          fill — the glyph reading as more "on" than the control it sits in. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 8 8"
        className="relative hidden h-2 w-2 text-paper peer-checked:block peer-disabled:opacity-50"
      >
        <path d="M1 4.2 L3.1 6.2 L7 1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}
