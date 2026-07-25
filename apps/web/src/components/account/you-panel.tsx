"use client";
import Link from "next/link";
import { signOutAndTeardownPush } from "@/lib/push";
import { playerSlug } from "@/lib/slug";
import { ApiError } from "@/lib/api";
import { useControls, useControlsActions } from "@/components/account/use-controls";
import { transferErrorLabel } from "@/components/account/format";
import { IdentityRow } from "@/components/account/identity-row";
import { TokensPanel, type MutationView } from "@/components/account/tokens-panel";

function mutView(m: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown }): MutationView {
  return {
    pending: m.isPending,
    ok: m.isSuccess,
    error: m.isError ? transferErrorLabel(m.error instanceof ApiError ? m.error.code : "") : null,
  };
}

/**
 * The account page body: identity, tokens and sign-out — the things a player changes rarely.
 *
 * ⚠️ The claim/verify ladder is deliberately NOT here. `unlinked` and `pending` are onboarding
 * states, which sub-project C's three-mode home owns, and /you must never be the only route to
 * claiming a gamertag. This page links there instead.
 */
export function YouPanel() {
  const c = useControls();
  const a = useControlsActions();

  if (c.status.kind === "loading") {
    return <div aria-busy="true" aria-hidden className="h-40 bg-bone motion-safe:animate-pulse" />;
  }

  if (c.status.kind === "signedOut") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="font-sans text-base text-ink-soft">You are not signed in.</p>
        <Link
          href="/login"
          className="border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
        >
          Sign in →
        </Link>
      </div>
    );
  }

  // Narrow on `c.status` directly: TypeScript does not carry the narrowing through a separate
  // boolean, so `verified ? c.status.link : …` fails to compile on the unlinked branch.
  const gamertag = c.status.kind === "verified" ? c.status.link.gamertag : null;
  const verified = gamertag !== null;

  return (
    <div className="flex flex-col gap-5">
      <IdentityRow
        name={gamertag ?? c.name ?? "You"}
        provider={c.provider}
        verified={verified}
        tagLine={c.status.kind === "unlinked" ? "No gamertag" : undefined}
      />

      {!verified && (
        <p className="font-sans text-base text-ink-soft">
          Claim and verify your gamertag on the{" "}
          <Link href="/" className="underline decoration-red decoration-2 underline-offset-2">
            home page
          </Link>
          .
        </p>
      )}

      {verified && (
        <TokensPanel
          balance={c.balance ?? 0}
          balanceLoading={c.balanceLoading}
          send={mutView(a.send)}
          referrer={mutView(a.refer)}
          onSend={(gt) => a.send.mutate(gt)}
          onSetReferrer={(gt) => a.refer.mutate(gt)}
          myGamertag={gamertag!}
        />
      )}

      {/* Sign-out renders in EVERY signed-in state — an unlinked or pending user must always be
       *  able to get out. The profile link only appears once a gamertag is verified. */}
      <div className="flex justify-between border-t border-hairline pt-3 font-mono text-[11px] uppercase tracking-[.05em]">
        {gamertag ? (
          <Link href={`/players/${playerSlug(gamertag)}`} className="font-bold text-ink hover:text-red">
            Your profile →
          </Link>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => void signOutAndTeardownPush()} className="text-ink-muted hover:text-red">
          Sign out
        </button>
      </div>
    </div>
  );
}
