"use client";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMe, getTokens, redeemToken, transferToken, setReferrer } from "@/lib/api";
import { useGamertagLinks, useCancelLink } from "@/lib/use-gamertag-links";
import { activeLink } from "@/lib/active-link";
import { LinksList } from "@/components/links-list";
import { TokenWallet } from "@/components/token-wallet";
import { signOut, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export default function AccountPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  const links = useGamertagLinks();
  const cancel = useCancelLink();
  const hasActiveLink = activeLink(links.data) !== null;
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: getTokens });
  const refreshTokens = () => qc.invalidateQueries({ queryKey: ["tokens"] });
  const redeem = useMutation({ mutationFn: () => redeemToken(), onSuccess: refreshTokens });
  const transfer = useMutation({ mutationFn: (to: string) => transferToken(to), onSuccess: refreshTokens });
  const referrer = useMutation({ mutationFn: (r: string) => setReferrer(r) });

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[32px] text-amber">Account</h1>
        <Button className="border border-line bg-panel text-bone hover:border-amber" onClick={() => void signOut().finally(() => { window.location.href = "/"; })}>Sign out</Button>
      </div>
      {session?.user && <p className="text-sm text-muted">Signed in as {session.user.email}</p>}
      <section>
        <h2 className="mb-3 border-b-2 border-line pb-2 font-display text-[20px] text-bone">Linked identities</h2>
        {me.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : me.isError ? (
          <p className="text-blood">Could not load your linked identities.</p>
        ) : (me.data?.accounts.length ?? 0) === 0 ? (
          <p className="text-muted">No linked providers.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {me.data!.accounts.map((a) => (
              <li key={`${a.providerId}:${a.accountId}`} className="rounded border border-line px-3 py-1 text-sm capitalize text-bone">
                {a.providerId}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="border-b-2 border-line pb-2 font-display text-[20px] text-bone">Gamertag links</h2>
          {!hasActiveLink && (
            <Link className="text-sm text-amber hover:underline" href="/account/claim">Claim a gamertag →</Link>
          )}
        </div>
        {links.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : links.isError ? (
          <p className="text-blood">Could not load your links.</p>
        ) : (
          <LinksList links={links.data ?? []} onCancel={(id) => cancel.mutate(id)} />
        )}
      </section>
      <TokenWallet
        balance={tokens.data?.balance ?? 0}
        redeeming={redeem.isPending}
        error={redeem.isError ? (redeem.error as Error).message : null}
        onRedeem={() => redeem.mutate()}
        onTransfer={(to) => transfer.mutate(to)}
        onSetReferrer={(r) => referrer.mutate(r)}
      />
    </main>
  );
}
