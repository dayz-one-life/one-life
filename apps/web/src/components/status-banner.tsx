import Link from "next/link";
import type { ReactNode } from "react";
import type { AccountStatus } from "@/lib/account-status";
import type { Challenge } from "@/lib/types";
import { formatExpiry } from "@/lib/format-expiry";
import { cn } from "@/lib/utils";

type StatusBannerProps = {
  status: AccountStatus;
  onCancel: () => void;
  onReclaim: () => void;
  canceling?: boolean;
  reclaiming?: boolean;
  now?: number;
};

const bigBtn = "rounded-lg bg-amber px-7 py-3.5 text-base font-bold text-black hover:opacity-90";
const quietBtn = "text-xs text-muted underline underline-offset-2 hover:text-amber disabled:opacity-50";

function BannerShell({ children }: { children: ReactNode }) {
  return <div className="border-y-2 border-amber bg-amber/20 px-6 py-4">{children}</div>;
}

function Invite({ title, subtitle, href, label }: { title: string; subtitle: string; href: string; label: string }) {
  return (
    <BannerShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
        <div className="flex-1">
          <p className="text-[17px] font-bold text-bone">{title}</p>
          <p className="mt-1 text-[13px] text-dim">{subtitle}</p>
        </div>
        <Link href={href} className={cn(bigBtn, "block w-full text-center sm:w-auto")}>{label}</Link>
      </div>
    </BannerShell>
  );
}

function EmoteChips({ sequence, progressIndex }: { sequence: string[]; progressIndex: number }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {sequence.map((emote, i) => {
        const done = i < progressIndex;
        return (
          <li key={i} data-done={String(done)}
            className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[13px]",
              done ? "border-line bg-panel text-muted line-through opacity-60" : "border-amber/40 bg-panel-2 text-bone")}>
            {done && <span aria-hidden className="text-amber no-underline">✓</span>}
            {emote}
          </li>
        );
      })}
    </ol>
  );
}

function Verify({ gamertag, challenge, onCancel, onReclaim, canceling, reclaiming, now }: {
  gamertag: string; challenge: Challenge | null;
  onCancel: () => void; onReclaim: () => void; canceling?: boolean; reclaiming?: boolean; now: number;
}) {
  const expired = !challenge || challenge.expired;
  if (expired) {
    return (
      <BannerShell>
        <p className="text-[17px] font-bold text-bone"><span aria-hidden className="text-amber">⚠</span> Your verification for <span>{gamertag}</span> expired</p>
        <p className="mt-1 text-[13px] text-dim">The emote challenge timed out. Start a fresh one and perform the new sequence in game.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <button onClick={onReclaim} disabled={reclaiming} className="rounded-lg bg-amber px-4 py-2 text-[13px] font-semibold text-black hover:opacity-90 disabled:opacity-50">Start a new challenge →</button>
          <button onClick={onCancel} disabled={canceling} className={quietBtn}>Cancel claim</button>
        </div>
      </BannerShell>
    );
  }
  return (
    <BannerShell>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[17px] font-bold text-bone"><span aria-hidden className="text-amber">⚠</span> Finish verifying <span>{gamertag}</span></p>
        <span className="text-[11px] font-extrabold tracking-wide text-amber">{challenge.progressIndex} / {challenge.sequence.length} DONE</span>
      </div>
      <p className="mt-1 text-[13px] text-dim">Log in to any One Life server and perform these emotes in order — we detect them automatically.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <EmoteChips sequence={challenge.sequence} progressIndex={challenge.progressIndex} />
        <div className="flex items-center gap-4 sm:ml-auto">
          <span className="text-xs text-muted">{formatExpiry(challenge.expiresAt, now)}</span>
          <button onClick={onCancel} disabled={canceling} className={quietBtn}>Cancel claim</button>
        </div>
      </div>
    </BannerShell>
  );
}

export function StatusBanner({ status, onCancel, onReclaim, canceling, reclaiming, now = Date.now() }: StatusBannerProps) {
  switch (status.kind) {
    case "loading":
    case "verified":
      return null;
    case "signedOut":
      return <Invite title="Sign in to claim your gamertag" subtitle="One account tracks your lives across every One Life server and lets you verify the gamertag that's yours." href="/login" label="Sign in →" />;
    case "unlinked":
      return <Invite title="Link your gamertag to get started" subtitle="Connect your Xbox gamertag to claim your lives and prove on the roster that they're yours." href="/account/claim" label="Link gamertag →" />;
    case "pending":
      return <Verify gamertag={status.link.gamertag} challenge={status.link.challenge} onCancel={onCancel} onReclaim={onReclaim} canceling={canceling} reclaiming={reclaiming} now={now} />;
  }
}
