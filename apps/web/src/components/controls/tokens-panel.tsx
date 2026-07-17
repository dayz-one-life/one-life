"use client";
import { useEffect, useState, type FormEvent } from "react";
import { GamertagAutocomplete } from "./gamertag-autocomplete";
import { searchVerifiedGamertags } from "@/lib/api";

export type MutationView = { pending: boolean; error: string | null; ok: boolean };

export function TokensPanel({
  balance,
  send,
  referrer,
  onSend,
  onSetReferrer,
  showReferrer = true,
  boxed = false,
  myGamertag,
}: {
  balance: number;
  send: MutationView;
  referrer: MutationView;
  onSend: (gamertag: string) => void;
  onSetReferrer: (gamertag: string) => void;
  showReferrer?: boolean;
  boxed?: boolean;
  myGamertag?: string;
}) {
  const [to, setTo] = useState("");
  const [ref, setRef] = useState("");
  useEffect(() => {
    if (send.ok) setTo("");
  }, [send.ok]);

  const submitSend = (e: FormEvent) => {
    e.preventDefault();
    if (to.trim()) onSend(to.trim());
  };
  const submitRef = (e: FormEvent) => {
    e.preventDefault();
    if (ref.trim()) onSetReferrer(ref.trim());
  };

  return (
    <section className={boxed ? "border border-dark-line p-4" : "bg-dark p-5"}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[15px] font-bold uppercase tracking-[.1em] text-paper">Unban tokens</h2>
        <span className="font-display text-[26px] font-bold leading-none text-paper">{balance}</span>
      </div>
      <form onSubmit={submitSend} className="mt-3 flex gap-2 border-t border-dark-line pt-3">
        <GamertagAutocomplete
          aria-label="Send a token to a verified player"
          placeholder="SEND TO VERIFIED PLAYER…"
          value={to}
          onChange={setTo}
          fetchSuggestions={searchVerifiedGamertags}
          exclude={myGamertag}
          className="min-w-0 flex-1"
          inputClassName="w-full border border-dark-line bg-[#111] px-3 py-2 font-mono text-[11.5px] tracking-[.04em] text-paper outline-none placeholder:text-cream-muted focus:border-paper"
        />
        <button
          type="submit"
          disabled={balance < 1 || !to.trim() || send.pending}
          className="-skew-x-[5deg] bg-paper px-3.5 py-2 font-display text-[12.5px] font-bold uppercase tracking-[.1em] text-ink disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {send.error && <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{send.error}</p>}
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[.04em] text-cream-muted">
        +1 every 1st of the month · Transfers are final
      </p>
      {showReferrer && !referrer.ok && (
        <>
          <form onSubmit={submitRef} className="mt-3 flex items-center gap-2 border-t border-dark-line pt-3">
            <GamertagAutocomplete
              aria-label="Referred by"
              placeholder="REFERRED BY…"
              value={ref}
              onChange={setRef}
              fetchSuggestions={searchVerifiedGamertags}
              exclude={myGamertag}
              className="min-w-0 flex-1"
              inputClassName="w-full border border-dark-line bg-[#111] px-3 py-2 font-mono text-[11.5px] tracking-[.04em] text-paper outline-none placeholder:text-cream-muted focus:border-paper"
            />
            <button
              type="submit"
              disabled={!ref.trim() || referrer.pending}
              className="font-mono text-[10.5px] uppercase tracking-[.05em] text-cream-dim underline underline-offset-2 disabled:opacity-50"
            >
              Set
            </button>
          </form>
          {referrer.error && (
            <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{referrer.error}</p>
          )}
        </>
      )}
    </section>
  );
}
