"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TokenWalletProps = {
  balance: number;
  onRedeem: () => void;
  onTransfer: (toUserId: string) => void;
  onSetReferrer: (referrerUserId: string) => void;
  redeeming?: boolean;
  error?: string | null;
};

export function TokenWallet({ balance, onRedeem, onTransfer, onSetReferrer, redeeming, error }: TokenWalletProps) {
  const [to, setTo] = useState("");
  const [ref, setRef] = useState("");

  const submitTransfer = (e: FormEvent) => { e.preventDefault(); if (to) { onTransfer(to); setTo(""); } };
  const submitReferrer = (e: FormEvent) => { e.preventDefault(); if (ref) { onSetReferrer(ref); setRef(""); } };

  return (
    <section>
      <h2 className="mb-3 border-b-2 border-line pb-2 font-display text-[20px] text-bone">Unban tokens</h2>
      <p className="mb-3 text-sm text-muted">
        Balance: <span className="font-mono text-lg text-amber">{balance}</span>
      </p>

      <Button className="mb-2" disabled={balance < 1 || redeeming} onClick={onRedeem}>
        {redeeming ? "Lifting…" : "Use a token to lift my ban"}
      </Button>
      {error && <p className="mb-3 text-sm text-blood">{error}</p>}

      <form onSubmit={submitTransfer} className="mb-3 flex gap-2">
        <Input aria-label="Transfer recipient user id" placeholder="Recipient user id" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button type="submit" disabled={balance < 1 || !to}>Transfer</Button>
      </form>

      <form onSubmit={submitReferrer} className="flex gap-2">
        <Input aria-label="Referrer user id" placeholder="Referrer user id" value={ref} onChange={(e) => setRef(e.target.value)} />
        <Button type="submit" disabled={!ref}>Set referrer</Button>
      </form>
    </section>
  );
}
