import Link from "next/link";
import type { ReactNode } from "react";
import type { AccountStatus } from "@/lib/account-status";
import type { Challenge } from "@/lib/types";
import { formatExpiry } from "@/lib/format-expiry";
import { cn } from "@/lib/utils";
import { SkewCta } from "@/components/tabloid/skew-cta";

type StatusBannerProps = {
  status: AccountStatus;
  onCancel: () => void;
  onReclaim: () => void;
  canceling?: boolean;
  reclaiming?: boolean;
  now?: number;
};

const quietBtn =
  "font-mono text-xs uppercase text-ink-muted underline underline-offset-2 hover:text-red disabled:opacity-50";

function BannerShell({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "pending" }) {
  return (
    <div className={cn("px-6 py-4 bg-tint", tone === "pending" ? "border-y-2 border-yellow" : "border-y border-ink")}>
      {children}
    </div>
  );
}

function Invite({ title, subtitle, href, label }: { title: string; subtitle: string; href: string; label: string }) {
  return (
    <BannerShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
        <div className="flex-1">
          <p className="font-display text-lg font-bold uppercase text-ink">{title}</p>
          <p className="mt-1 font-sans text-[13px] text-ink-soft">{subtitle}</p>
        </div>
        <SkewCta href={href}>{label}</SkewCta>
      </div>
    </BannerShell>
  );
}

function EmoteChips({ sequence, progressIndex }: { sequence: string[]; progressIndex: number }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {sequence.map((emote, i) => {
        const done = i < progressIndex;
        const current = i === progressIndex;
        return (
          <li
            key={i}
            data-done={String(done)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 font-mono text-[12px] uppercase tracking-[.05em]",
              done && "bg-ink text-paper",
              current && "border-2 border-dashed border-ink font-bold text-ink",
              !done && !current && "border border-dashed border-dash text-ink-muted",
            )}
          >
            {done && <span aria-hidden className="text-paper">✓</span>}
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
      <BannerShell tone="pending">
        <p className="font-display text-lg font-bold uppercase text-ink">Your verification for <span>{gamertag}</span> expired</p>
        <p className="mt-1 font-sans text-[13px] text-ink-soft">The emote challenge timed out. Start a fresh one and perform the new sequence in game.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <SkewCta onClick={onReclaim} disabled={reclaiming}>Start a new challenge →</SkewCta>
          <button onClick={onCancel} disabled={canceling} className={quietBtn}>Cancel claim</button>
        </div>
      </BannerShell>
    );
  }
  return (
    <BannerShell tone="pending">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-display text-lg font-bold uppercase text-ink">Finish verifying <span>{gamertag}</span></p>
        <span className="font-mono text-[11px] font-bold tracking-[.06em] text-ink">{challenge.progressIndex} / {challenge.sequence.length} DONE</span>
      </div>
      <p className="mt-1 font-sans text-[13px] text-ink-soft">Log in to any One Life server and perform these emotes in order — we detect them automatically.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <EmoteChips sequence={challenge.sequence} progressIndex={challenge.progressIndex} />
        <div className="flex items-center gap-4 sm:ml-auto">
          <span className="font-mono text-xs text-ink-muted">{formatExpiry(challenge.expiresAt, now)}</span>
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
