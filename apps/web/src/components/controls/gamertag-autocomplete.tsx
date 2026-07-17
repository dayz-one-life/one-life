"use client";
import { useEffect, useRef, useState } from "react";

/** Controlled gamertag input with a debounced, race-guarded suggestion dropdown.
 *  `fetchSuggestions` is injected; `exclude` (case-insensitive) drops the current player. */
export function GamertagAutocomplete({
  value,
  onChange,
  fetchSuggestions,
  exclude,
  placeholder,
  id,
  "aria-label": ariaLabel,
  className,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  fetchSuggestions: (q: string) => Promise<string[]>;
  exclude?: string;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
  inputClassName?: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);

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
      return;
    }
    const t = setTimeout(() => {
      const seq = ++searchSeq.current;
      fetchSuggestions(q)
        .then((results) => {
          if (seq !== searchSeq.current) return;
          const ex = exclude?.toLowerCase();
          setSuggestions(results.filter((r) => r.toLowerCase() !== ex));
        })
        .catch(() => {
          if (seq === searchSeq.current) setSuggestions([]);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [value, exclude, fetchSuggestions]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <input
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        placeholder={placeholder}
        className={inputClassName}
      />
      {suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 border border-t-0 border-dark-line bg-[#111]">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  skipSearch.current = true;
                  searchSeq.current++; // invalidate any in-flight search
                  onChange(s);
                  setSuggestions([]);
                }}
                className="w-full px-3 py-2 text-left font-mono text-xs uppercase text-cream-dim hover:bg-[#1A1A12] hover:text-paper"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
