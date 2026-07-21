"use client";
import { useId, useState } from "react";
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
  // LinkTagPanel mounts simultaneously on the rail (xl+) and in the mobile sheet, so a fixed
  // id/error-node id would duplicate in the DOM and aria-describedby could resolve to the
  // wrong (possibly hidden) instance. useId() gives each mounted instance its own unique base.
  const uid = useId();
  const inputId = `${uid}-gamertag`;
  const errorId = `${uid}-gamertag-error`;

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
        <label htmlFor={inputId} className="sr-only">
          Gamertag
        </label>
        <GamertagAutocomplete
          id={inputId}
          value={tag}
          onChange={setTag}
          fetchSuggestions={searchClaimableGamertags}
          placeholder="GAMERTAG…"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          inputClassName="w-full border border-paper bg-dark-well px-3 py-2.5 font-mono text-base xl:text-[13px] tracking-[.04em] text-paper outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red placeholder:text-cream-muted"
        />
        <button
          type="submit"
          disabled={pending || !tag.trim()}
          className="mt-3 -skew-x-[5deg] bg-paper px-4 py-2 font-display text-[13px] font-bold uppercase tracking-[.08em] text-ink disabled:opacity-50"
        >
          {pending ? "Claiming…" : "Claim it"}
        </button>
      </form>
      {error && <p id={errorId} role="alert" className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{error}</p>}
      <p className="mt-2.5 font-mono text-[10px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
        We suggest tags seen on our servers. Verifying earns 1 token.
      </p>
    </section>
  );
}
