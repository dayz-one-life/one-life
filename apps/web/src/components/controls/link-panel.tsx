"use client";
import { useState } from "react";
import { searchClaimableGamertags } from "@/lib/api";
import { GamertagAutocomplete } from "./gamertag-autocomplete";

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
        <GamertagAutocomplete
          id="rail-gamertag"
          value={tag}
          onChange={setTag}
          fetchSuggestions={searchClaimableGamertags}
          placeholder="GAMERTAG…"
          inputClassName="w-full border border-paper bg-dark-well px-3 py-2.5 font-mono text-base xl:text-[13px] tracking-[.04em] text-paper outline-none placeholder:text-cream-muted"
        />
        <button
          type="submit"
          disabled={pending || !tag.trim()}
          className="mt-3 -skew-x-[5deg] bg-paper px-4 py-2 font-display text-[13px] font-bold uppercase tracking-[.08em] text-ink disabled:opacity-50"
        >
          {pending ? "Claiming…" : "Claim it"}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{error}</p>}
      <p className="mt-2.5 font-mono text-[10px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
        We suggest tags seen on our servers. Verifying earns 1 token.
      </p>
    </section>
  );
}
