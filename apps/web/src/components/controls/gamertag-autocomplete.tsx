"use client";
import { useEffect, useId, useRef, useState } from "react";
import { SrStatus } from "@/components/shared/sr-status";

/** Controlled gamertag input with a debounced, race-guarded suggestion dropdown.
 *  `fetchSuggestions` is injected; `exclude` (case-insensitive) drops the current player.
 *  Pass a STABLE `fetchSuggestions` reference (a module-level function, not an inline arrow) — an unstable one re-arms the 200ms debounce every render.
 *  Implements the WAI-ARIA 1.2 combobox-with-listbox pattern: DOM focus stays on the input
 *  (options are not in the tab order); the highlighted option is tracked virtually via
 *  `aria-activedescendant` and moved with ArrowDown/ArrowUp, Enter picks it, Escape closes the
 *  popup without clearing the query. */
export function GamertagAutocomplete({
  value,
  onChange,
  onPick,
  fetchSuggestions,
  exclude,
  placeholder,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  className,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Fires ONLY when a suggestion is actually chosen (click or Enter on a highlighted
   *  option) — `onChange` cannot be used to detect this, because a pick arrives as an
   *  onChange carrying text a keystroke could equally have produced. */
  onPick?: (v: string) => void;
  fetchSuggestions: (q: string) => Promise<string[]>;
  exclude?: string;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // `open` tracks whether the listbox popup is shown; kept independent of `suggestions` so
  // Escape can dismiss the popup without discarding the fetched results (ArrowDown/ArrowUp
  // reopen it). `highlightedIndex` is the virtual-focus index (-1 = nothing highlighted).
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // Only true once a real search has completed (or failed) — while false, the result-count
  // live region renders empty (present, not absent — see the SrStatus render below) rather
  // than announcing on the initial/below-threshold/just-picked state.
  const [searched, setSearched] = useState(false);

  const listId = useId();

  // Race guards: drop out-of-order responses; don't re-search right after a pick.
  const searchSeq = useRef(0);
  const skipSearch = useRef(false);

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setHighlightedIndex(-1);
      setSearched(false);
      return;
    }
    const t = setTimeout(() => {
      const seq = ++searchSeq.current;
      fetchSuggestions(q)
        .then((results) => {
          if (seq !== searchSeq.current) return;
          const ex = exclude?.toLowerCase();
          const filtered = results.filter((r) => r.toLowerCase() !== ex);
          setSuggestions(filtered);
          setOpen(filtered.length > 0);
          setHighlightedIndex(-1);
          setSearched(true);
        })
        .catch(() => {
          if (seq === searchSeq.current) {
            setSuggestions([]);
            setOpen(false);
            setHighlightedIndex(-1);
            setSearched(false);
          }
        });
    }, 200);
    return () => clearTimeout(t);
  }, [value, exclude, fetchSuggestions]);

  function pick(s: string) {
    skipSearch.current = true;
    searchSeq.current++; // invalidate any in-flight search
    onChange(s);
    onPick?.(s);
    setSuggestions([]);
    setOpen(false);
    setHighlightedIndex(-1);
    setSearched(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setHighlightedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (open && highlightedIndex >= 0 && suggestions[highlightedIndex] !== undefined) {
        e.preventDefault();
        pick(suggestions[highlightedIndex]!);
      }
    } else if (e.key === "Escape") {
      if (open) {
        setOpen(false);
        setHighlightedIndex(-1);
      }
    }
  }

  const expanded = open && suggestions.length > 0;
  const activeOptionId =
    open && highlightedIndex >= 0 ? `${listId}-opt-${highlightedIndex}` : undefined;
  const matchText = !searched
    ? ""
    : suggestions.length === 0
      ? "No matches"
      : `${suggestions.length} match${suggestions.length === 1 ? "" : "es"}`;

  return (
    <div className={`relative ${className ?? ""}`}>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        placeholder={placeholder}
        className={inputClassName}
        onFocus={(e) =>
          e.currentTarget.scrollIntoView?.({
            block: "center",
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          })
        }
      />
      {/* Always mounted so `aria-controls={listId}` on the input never dangles (WAI-ARIA APG
       *  combobox pattern). `hidden` (display:none) removes it from the a11y tree when there's
       *  nothing to show, and it renders no <li> children then either — an empty listbox is
       *  never exposed to AT. */}
      <ul
        role="listbox"
        id={listId}
        hidden={!expanded}
        className="absolute left-0 right-0 top-full z-20 max-h-[210px] overflow-y-auto border border-t-0 border-dark-line bg-dark-well"
      >
        {expanded &&
          suggestions.map((s, index) => (
            <li
              key={s}
              id={`${listId}-opt-${index}`}
              role="option"
              aria-selected={index === highlightedIndex}
              onClick={() => pick(s)}
              className="w-full cursor-pointer px-3 py-2 text-left font-mono text-xs uppercase text-cream-dim hover:bg-dark-hollow hover:text-paper"
            >
              {s}
            </li>
          ))}
      </ul>
      {/* Always mounted (never gated on `searched`) — some screen readers only announce
       *  mutations to a region that existed at the time of the change; empty before any
       *  search/after a pick, filled with the match count once a search completes. */}
      <SrStatus>{matchText}</SrStatus>
    </div>
  );
}
