"use client";
import { useEffect, useRef, useState } from "react";
import { searchClaimableGamertags } from "@/lib/api";

/** Unlinked rail state (canvas 10d): dark claim panel with claimable-tag autocomplete. */
export function LinkTagPanel({
  onClaim,
  pending,
  error,
}: {
  onClaim: (gamertag: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [tag, setTag] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Race guards: drop out-of-order responses; don't re-search right after a pick.
  const searchSeq = useRef(0);
  const skipSearch = useRef(false);

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const q = tag.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      const seq = ++searchSeq.current;
      searchClaimableGamertags(q)
        .then((results) => {
          if (seq === searchSeq.current) setSuggestions(results);
        })
        .catch(() => {
          if (seq === searchSeq.current) setSuggestions([]);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [tag]);

  return (
    <section className="bg-dark p-5">
      <h2 className="font-display text-[26px] font-bold uppercase leading-none text-paper">Link your gamertag.</h2>
      <p className="mt-2.5 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-cream-dim">
        The Xbox gamertag you play under. One per account.
      </p>
      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (tag.trim()) onClaim(tag.trim());
        }}
      >
        <label htmlFor="rail-gamertag" className="sr-only">
          Gamertag
        </label>
        <input
          id="rail-gamertag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          autoComplete="off"
          placeholder="GAMERTAG…"
          className="w-full border border-paper bg-[#111] px-3 py-2.5 font-mono text-[13px] tracking-[.04em] text-paper outline-none placeholder:text-cream-muted"
        />
        {suggestions.length > 0 && (
          <ul className="border border-t-0 border-dark-line bg-[#111]">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => {
                    skipSearch.current = true;
                    searchSeq.current++; // invalidate any in-flight search
                    setTag(s);
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
        <button
          type="submit"
          disabled={pending || !tag.trim()}
          className="mt-3 -skew-x-[5deg] bg-paper px-4 py-2 font-display text-[13px] font-bold uppercase tracking-[.08em] text-ink disabled:opacity-50"
        >
          {pending ? "Claiming…" : "Claim it"}
        </button>
      </form>
      {error && <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{error}</p>}
      <p className="mt-2.5 font-mono text-[10px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
        We suggest tags seen on our servers. Verifying earns 1 token.
      </p>
    </section>
  );
}
