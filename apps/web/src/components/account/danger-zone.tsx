"use client";

import { useState } from "react";
import { DeleteAccountDialog } from "./delete-account-dialog";

export function DangerZone() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-10 border border-red-deep/40 px-5 py-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em] text-red-deep">Danger zone</h2>
      <p className="mt-2 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink-muted">
        Deleting your account removes your sign-in, your gamertag link and your avatar. Your
        lives, deaths and obituaries stay on the site — they belong to the gamertag, not the
        account.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 border border-red-deep px-4 py-2 font-mono text-xs uppercase tracking-[.04em] text-red-deep"
      >
        Delete account
      </button>
      <DeleteAccountDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
