"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import { GamertagAutocomplete } from "@/components/shared/gamertag-autocomplete";
import { searchVerifiedGamertags } from "@/lib/api";
import { SrStatus } from "@/components/shared/sr-status";

export type MutationView = { pending: boolean; error: string | null; ok: boolean };

/**
 * Balance + send, as the LIGHT card the verified-desktop mock draws (the old dark-island
 * treatment is gone with the drift correction). The manual "referred by" form is retired —
 * referral attribution arrives with sub-project F's invite links, not a form.
 */
export function TokensPanel({
  balance,
  balanceLoading = false,
  send,
  onSend,
  myGamertag,
}: {
  balance: number;
  /** True while the balance behind `balance` is unresolved (loading/errored) — the readout
   *  must not assert a fabricated numeral (e.g. "0") in that state (live-data honesty §5). */
  balanceLoading?: boolean;
  send: MutationView;
  onSend: (gamertag: string) => void;
  myGamertag?: string;
}) {
  // useId() gives each mounted instance its own unique base for the error-node ids. A fixed id
  // would collide if the panel is ever mounted twice (it was, on the rail and the sheet, before
  // sub-project B) and aria-describedby could resolve to the wrong instance.
  const uid = useId();
  const sendErrorId = `${uid}-send-token-error`;
  const [to, setTo] = useState("");
  useEffect(() => {
    if (send.ok) setTo("");
  }, [send.ok]);

  const submitSend = (e: FormEvent) => {
    e.preventDefault();
    if (to.trim()) onSend(to.trim());
  };

  return (
    <section className="border border-hairline bg-white px-3.5 py-3">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[.12em] text-ink">Unban tokens</h2>
        {balanceLoading ? (
          <span aria-busy="true" className="inline-block h-[26px] w-9 motion-safe:animate-pulse bg-bone">
            <span className="sr-only">Checking your balance…</span>
          </span>
        ) : (
          <span className="font-display text-[30px] font-bold leading-none text-ink">{balance}</span>
        )}
      </div>
      <form onSubmit={submitSend} className="mt-2.5 flex gap-2 border-t border-ink/10 pt-2.5">
        <GamertagAutocomplete
          aria-label="Send a token to a verified player"
          aria-describedby={send.error ? sendErrorId : undefined}
          aria-invalid={send.error ? true : undefined}
          placeholder="SEND TO VERIFIED PLAYER…"
          value={to}
          onChange={setTo}
          fetchSuggestions={searchVerifiedGamertags}
          exclude={myGamertag}
          className="min-w-0 flex-1"
          inputClassName="w-full border border-hairline bg-paper px-3 py-2 font-mono text-base xl:text-[11.5px] tracking-[.04em] text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red placeholder:text-ink-muted focus:border-ink"
        />
        <button
          type="submit"
          disabled={balance < 1 || !to.trim() || send.pending}
          className="bg-ink px-3.5 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-paper disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {send.error && (
        <p id={sendErrorId} role="alert" className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-deep">{send.error}</p>
      )}
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[.04em] text-ink-muted">
        +1 every 1st of the month · Transfers are final
      </p>
      <SrStatus>{send.ok ? `Token sent — balance ${balance}` : ""}</SrStatus>
    </section>
  );
}
