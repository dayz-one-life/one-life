"use client";
import { useEffect, useState, type FormEvent } from "react";
import { GamertagAutocomplete } from "./gamertag-autocomplete";
import { searchVerifiedGamertags } from "@/lib/api";
import { SrStatus } from "@/components/shared/sr-status";

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

  // A single always-present announcer: content changes on send.ok/referrer.ok. It must live
  // outside the `!referrer.ok` block below, which unmounts the referrer form (and would take
  // an announcer down with it) the instant referrer.ok flips true.
  const statusMessage = send.ok ? `Token sent — balance ${balance}` : referrer.ok ? "Referrer set" : "";

  return (
    <section className={boxed ? "border border-dark-line p-4" : "bg-dark p-5"}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[15px] font-bold uppercase tracking-[.1em] text-paper">Unban tokens</h2>
        <span className="font-display text-[26px] font-bold leading-none text-paper">{balance}</span>
      </div>
      <form onSubmit={submitSend} className="mt-3 flex gap-2 border-t border-dark-line pt-3">
        <GamertagAutocomplete
          aria-label="Send a token to a verified player"
          aria-describedby={send.error ? "send-token-error" : undefined}
          aria-invalid={send.error ? true : undefined}
          placeholder="SEND TO VERIFIED PLAYER…"
          value={to}
          onChange={setTo}
          fetchSuggestions={searchVerifiedGamertags}
          exclude={myGamertag}
          className="min-w-0 flex-1"
          inputClassName="w-full border border-dark-line bg-dark-well px-3 py-2 font-mono text-base xl:text-[11.5px] tracking-[.04em] text-paper outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red placeholder:text-cream-muted focus:border-paper"
        />
        <button
          type="submit"
          disabled={balance < 1 || !to.trim() || send.pending}
          className="-skew-x-[5deg] bg-paper px-3.5 py-2 font-display text-[12.5px] font-bold uppercase tracking-[.1em] text-ink disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {send.error && (
        <p id="send-token-error" role="alert" className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{send.error}</p>
      )}
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[.04em] text-cream-muted xl:text-[10px]">
        +1 every 1st of the month · Transfers are final
      </p>
      {showReferrer && !referrer.ok && (
        <>
          <form onSubmit={submitRef} className="mt-3 flex items-center gap-2 border-t border-dark-line pt-3">
            <GamertagAutocomplete
              aria-label="Referred by"
              aria-describedby={referrer.error ? "referrer-error" : undefined}
              aria-invalid={referrer.error ? true : undefined}
              placeholder="REFERRED BY…"
              value={ref}
              onChange={setRef}
              fetchSuggestions={searchVerifiedGamertags}
              exclude={myGamertag}
              className="min-w-0 flex-1"
              inputClassName="w-full border border-dark-line bg-dark-well px-3 py-2 font-mono text-base xl:text-[11.5px] tracking-[.04em] text-paper outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red placeholder:text-cream-muted focus:border-paper"
            />
            <button
              type="submit"
              disabled={!ref.trim() || referrer.pending}
              className="inline-flex min-h-[44px] items-center xl:min-h-0 font-mono text-[10.5px] uppercase tracking-[.05em] text-cream-dim underline underline-offset-2 disabled:opacity-50"
            >
              Set
            </button>
          </form>
          {referrer.error && (
            <p id="referrer-error" role="alert" className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{referrer.error}</p>
          )}
        </>
      )}
      <SrStatus>{statusMessage}</SrStatus>
    </section>
  );
}
