"use client";
/**
 * THROWAWAY DESIGN PREVIEW — NEVER SHIPS. Untracked; delete before any real work lands.
 *
 * Round 3. Converged on the LIFE TICKETS stage (round 2's variant E); D/The-board and F/The-wall
 * are dropped. Round 1 (A/B/C) was scrapped for assuming ONE lead standing, which cannot describe a
 * player alive on two servers, banned on a third and clear on a fourth at once. Fleet size is
 * always data, never a constant.
 *
 * This round adds the profile question: the same stage serves `/` (owner) and `/players/{slug}`
 * (public). `/players/{me}` 307s to `/`, so the owner never lands on their own public page except
 * through the explicit escape hatch. Use the VIEWER toggle to compare the two.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { FitLine } from "@/components/front-page/fit-line";
import { Avatar } from "@/components/shared/avatar";
import { HowToConnect } from "@/components/servers/how-to-connect";

const GAMERTAG = "Manicdote";
const BALANCE = 3;
const JOINED = 2;
const REF_LINK = "https://dayzonelife.com/i/manicdote";
const SERVERS = { kind: "ready" as const, names: ["Chernarus", "Livonia", "Namalsk"] };

type Viewer = "owner" | "public";

/* ────────────────────────── the model ────────────────────────── */

type RowState = "alive" | "banned" | "idle";
type Row = {
  slug: string;
  map: string;
  state: RowState;
  /** The display-scale figure. Null for idle — there is no number, and we never fabricate one. */
  figure: string | null;
  sub: string;
  /** The life this ticket's Timeline button points at. Null → no button rather than a broken link. */
  life: number | null;
  /** Provisional = inside the 5-minute grace window. Must never read as qualified. */
  provisional?: boolean;
  record?: boolean;
};

const R = {
  chernAlive: { slug: "chernarus", map: "Chernarus", state: "alive", figure: "4d 2h", sub: "Life 7 · since 25 Jul", life: 7, record: true },
  chernIdle: { slug: "chernarus", map: "Chernarus", state: "idle", figure: null, sub: "Died 8d ago · life 6", life: 6 },
  livBanned: { slug: "livonia", map: "Livonia", state: "banned", figure: "18h 22m", sub: "Mauled · life 11", life: 11 },
  livIdle: { slug: "livonia", map: "Livonia", state: "idle", figure: null, sub: "Died 2d ago · life 11", life: 11 },
  namAlive: { slug: "namalsk", map: "Namalsk", state: "alive", figure: "6h 41m", sub: "Life 3 · since today", life: 3 },
  namIdle: { slug: "namalsk", map: "Namalsk", state: "idle", figure: null, sub: "Never played", life: null },
  badFresh: { slug: "badlands", map: "Badlands", state: "alive", figure: "12m", sub: "Death is free for another 4m", life: 1, provisional: true },
} satisfies Record<string, Row>;

type ScenarioKey = "one" | "mixed" | "four" | "none";
const SCENARIOS: Record<ScenarioKey, Row[]> = {
  one: [R.chernAlive, R.livIdle, R.namIdle],
  mixed: [R.chernAlive, R.livBanned, R.namAlive],
  four: [R.chernAlive, R.livBanned, R.namAlive, R.badFresh],
  none: [R.chernIdle, R.livIdle, R.namIdle],
};
const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  one: "1 alive, 2 clear",
  mixed: "2 alive + 1 banned",
  four: "4 servers, all live",
  none: "Nothing running",
};

function tally(rows: Row[]) {
  const alive = rows.filter((r) => r.state === "alive").length;
  const banned = rows.filter((r) => r.state === "banned").length;
  const idle = rows.filter((r) => r.state === "idle").length;
  return { alive, banned, idle, headline: alive === 0 ? "Nothing running" : alive === 1 ? "One life running" : `${alive} lives running` };
}

const KICKER = "font-mono text-xs uppercase tracking-[.28em] text-cream-dim";

/* ────────────────────────── identity ────────────────────────── */

/**
 * Owner: circular avatar + pencil, which opens the real `AvatarPanel` flow.
 * Public: the same circle, read-only — no pencil, no upload affordance at all.
 * Always via the shared `Avatar` (the one place the circle shape is stated).
 */
function AvatarBlock({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative inline-block flex-none">
        <Avatar hash={null} size={112} variant="dark" fallbackInitial="M" />
        {viewer === "owner" && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Update your photo"
            className="absolute -bottom-1 -right-1 flex h-11 w-11 items-center justify-center rounded-full border-2 border-dark bg-yellow text-dark hover:bg-paper"
          >
            <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <p className="max-w-[13rem] font-mono text-[10px] uppercase tracking-[.08em] text-cream-muted">
          (Real build opens the AvatarPanel flow — upload / pull from Discord / remove)
        </p>
      )}
    </div>
  );
}

/* ────────────────────────── the stage ────────────────────────── */

function TicketStage({ rows, viewer }: { rows: Row[]; viewer: Viewer }) {
  const t = tally(rows);
  const owner = viewer === "owner";
  const cols = rows.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : rows.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <section className="border-b-[6px] border-red bg-dark px-6 py-12 text-paper md:px-10 md:py-16">
      {/* The GAMERTAG is the h1 — it reads identically on `/` and on someone else's page, which
       *  the old "2 lives running" headline did not (it was second-person on a public page). The
       *  aggregate survives as the tally strip below: still stated, no longer shouted. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-5 sm:flex-nowrap">
        <AvatarBlock viewer={viewer} />
        <div className="min-w-0 flex-1">
          <p className={KICKER}>Survivor · verified</p>
          <h1 className="mt-2 font-display font-bold uppercase leading-[.9]">
            <FitLine finalText={GAMERTAG} lineClassName="text-[clamp(2.25rem,8vw,7rem)]">
              {GAMERTAG}
            </FitLine>
          </h1>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[.16em] text-cream-muted">
            {/* ⚠️ `whitespace-nowrap` per item — at 390px the strip broke INSIDE a pair ("0 /
             *  clear"), which reads as a different number. Break between items or not at all. */}
            <span className={cn("whitespace-nowrap", t.alive > 0 && "font-bold text-yellow")}>{t.alive} alive</span>
            {" · "}
            <span className={cn("whitespace-nowrap", t.banned > 0 && "font-bold text-red")}>{t.banned} banned</span>
            {" · "}
            <span className="whitespace-nowrap">{t.idle} clear</span>
            {" · "}
            <span className="whitespace-nowrap">{rows.length} servers</span>
          </p>
        </div>
      </div>

      <p className="mt-7 max-w-2xl font-sans text-lg leading-relaxed text-cream-dim">
        {t.banned > 0 ? (
          owner ? (
            <>
              <span className="font-bold text-red">Banned on {t.banned === 1 ? "one server" : `${t.banned} servers`}.</span>{" "}
              A token lifts a ban the moment you spend it — {BALANCE} in hand.
            </>
          ) : (
            <>
              <span className="font-bold text-red">Banned on {t.banned === 1 ? "one server" : `${t.banned} servers`}.</span>{" "}
              Every life here is tracked to the minute, birth to death, across sessions.
            </>
          )
        ) : (
          <>Every life here is tracked to the minute, birth to death, across sessions.</>
        )}
      </p>

      <ul role="list" className={cn("mt-8 grid grid-cols-1 gap-4", cols)}>
        {rows.map((r) => (
          <li
            key={r.slug}
            className={cn(
              "relative flex min-h-[210px] flex-col border-2 bg-paper px-4 py-4 text-ink",
              r.state === "idle" ? "border-dashed border-ink/40" : "border-ink",
              r.state === "banned" && "border-red",
            )}
          >
            <p className="font-mono text-[11px] font-bold uppercase tracking-[.18em] text-ink-muted">{r.map}</p>
            <p
              className={cn(
                "mt-auto whitespace-nowrap font-display font-bold uppercase leading-[.9] tabular-nums",
                r.state === "banned" ? "text-red-deep" : r.state === "alive" ? "text-ink" : "text-ink-muted",
                r.figure ? "text-[clamp(1.75rem,4.5vw,3rem)]" : "text-2xl",
              )}
            >
              {r.figure ?? "No life"}
            </p>
            <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[.06em] text-ink-muted">
              {r.state === "banned" ? "Left on the ban" : r.state === "alive" ? (r.provisional ? "Not yet qualified" : "Alive") : "Clear to spawn"}
            </p>
            <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[.04em] text-ink-soft">{r.sub}</p>

            {/* ⚠️ Every ticket carries a TIMELINE link, in BOTH viewers (Steve, 2026-07-30 — this
             *  reverses the round-3 "no ticket links out" rule, which had itself reversed an
             *  earlier instruction; the link is back and it stays). It points at THIS ticket's
             *  life — the running one where the player is alive, the one that got them banned on a
             *  banned ticket, the last one on an idle ticket. `life: null` (never played this map)
             *  renders NO link rather than a broken one.
             *
             *  Spend stays owner-only and banned-only: the ticket is the one place that knows
             *  WHICH ban a token would lift. */}
            {(r.life != null || (owner && r.state === "banned")) && (
              <div className="mt-3.5 flex flex-col gap-2">
                {owner && r.state === "banned" && (
                  <button type="button" className="w-full bg-red px-3 py-2.5 font-mono text-[10px] uppercase tracking-[.1em] text-white">
                    Spend 1 token
                  </button>
                )}
                {r.life != null && (
                  <a
                    href={`/players/manicdote/${r.slug}/lives/${r.life}`}
                    className="flex min-h-[38px] w-full items-center justify-center border-2 border-ink px-3 font-mono text-[10px] uppercase tracking-[.1em] text-ink hover:bg-ink hover:text-paper"
                  >
                    Timeline <span aria-hidden className="ml-1.5">→</span>
                  </a>
                )}
              </div>
            )}

            {r.record && (
              <span aria-hidden className="pointer-events-none absolute -right-1 top-3 -rotate-[6deg] border-2 border-red bg-paper px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[.08em] text-red">
                Record
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* "View your public page" was dropped deliberately: the public view is this same stage with
       *  affordances removed, so there is nothing to inspect, and the `?public=1` bypass it needed
       *  would put a query-string escape on a session-conditional redirect. If sharing is the real
       *  need, it belongs with the invite controls below, not here. */}
    </section>
  );
}

/* ────────────────────────── below the stage ────────────────────────── */

/* ══════════════════════ token + invite controls ══════════════════════
 * Three directions. All three carry the SAME four facts, so the choice is presentation only:
 *   tokens: balance · send to a verified player · how you earn them · transfers are final
 *   invite: your link · copy it · how many joined · what a join pays you
 * The old treatment was two thin white cards with 10px mono microcopy — it read as pasted in
 * under a display-scale stage, which is the same failure the connect section had. */

const SEND_HINT = "A token you send cannot come back";
const INVITE_HINT = "+1 token when someone you invite verifies their gamertag";

/** ⚠️ The two ways a token appears. Rendered as a chip row so the tokens half has the SAME number
 *  of control rows as the invite half (field + row + hint) — that is what squares the two columns.
 *  It is not decoration: both rules were previously buried in the one-line hint. */
const EARN_RULES = ["+1 on the 1st", "+1 per invite"];

/* ══════════════════════ share bar ══════════════════════
 * The invite affordance is a SHARE BAR, not a copy field with a button bolted on: the link sits in
 * a read-only field and every place a survivor might actually paste it gets its own target.
 *
 * ⚠️ Discord has NO web share intent — there is no URL that opens a compose box with text in it.
 * So the Discord target is an honest copy-to-clipboard whose label says so ("Copied — paste it in
 * Discord"). Do not "fix" this by inventing a discord.com/share URL; it does not exist.
 *
 * ⚠️ The native sheet (`navigator.share`) is the right primary on a phone, but it is ABSENT on
 * desktop Chrome/Firefox, so it can never be the only way to share. It is rendered as an EXTRA
 * button, mounted only after the capability check runs client-side — never in place of the row.
 */

const SHARE_TEXT = "I'm running one life at a time on DayZ One Life. One death, one 24h ban. Come die with me.";

type Target = {
  key: string;
  label: string;
  /** null → this target copies to the clipboard instead of opening a URL (Discord). */
  href: string | null;
  /** Brand fill on hover. Keeps the row monochrome at rest so it reads as one control. */
  hover: string;
  path: React.ReactNode;
};

const enc = encodeURIComponent;
const TARGETS: Target[] = [
  {
    key: "discord",
    label: "Copy for Discord",
    href: null,
    hover: "hover:bg-discord hover:text-white hover:border-discord",
    path: (
      <path d="M19.3 5.3A16.7 16.7 0 0 0 15.2 4l-.3.6a12.6 12.6 0 0 0-5.8 0L8.8 4a16.7 16.7 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.7a16.9 16.9 0 0 0 5.1 2.6l1.1-1.7a11 11 0 0 1-1.7-.8l.4-.3a12 12 0 0 0 10.8 0l.4.3a11 11 0 0 1-1.7.8l1.1 1.7a16.9 16.9 0 0 0 5.1-2.6c.4-4.3-.7-8.1-3-11.4ZM8.4 14.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.9.9 1.8 2c0 1.1-.8 2-1.8 2Zm7.2 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.9.9 1.8 2c0 1.1-.8 2-1.8 2Z" fill="currentColor" stroke="none" />
    ),
  },
  {
    key: "x",
    label: "Share on X",
    href: `https://x.com/intent/tweet?url=${enc(REF_LINK)}&text=${enc(SHARE_TEXT)}`,
    hover: "hover:bg-ink hover:text-white hover:border-ink",
    path: <path d="M3 3h4.2l4.6 6.2L17.1 3H21l-6.9 7.8L21.4 21h-4.2l-5-6.7L6 21H2.1l7.3-8.3L3 3Zm3 1.6 10.4 14.8h1.7L7.7 4.6H6Z" fill="currentColor" stroke="none" />,
  },
  {
    key: "reddit",
    label: "Share on Reddit",
    href: `https://www.reddit.com/submit?url=${enc(REF_LINK)}&title=${enc(SHARE_TEXT)}`,
    hover: "hover:bg-[#FF4500] hover:text-white hover:border-[#FF4500]",
    path: (
      <path d="M22 12a2 2 0 0 0-3.4-1.4 9.9 9.9 0 0 0-5-1.5l.9-4 2.8.6a1.7 1.7 0 1 0 .2-1.4l-3.5-.8a.7.7 0 0 0-.8.5l-1.1 5.1a9.9 9.9 0 0 0-5 1.5A2 2 0 1 0 3.6 14a4 4 0 0 0 0 .6c0 3.3 3.8 6 8.4 6s8.4-2.7 8.4-6a4 4 0 0 0 0-.6A2 2 0 0 0 22 12ZM8.3 13.4a1.4 1.4 0 1 1 1.4 1.4 1.4 1.4 0 0 1-1.4-1.4Zm7.6 3.9a5.5 5.5 0 0 1-3.9 1.2 5.5 5.5 0 0 1-3.9-1.2.5.5 0 0 1 .7-.7 4.6 4.6 0 0 0 3.2.9 4.6 4.6 0 0 0 3.2-.9.5.5 0 0 1 .7.7Zm-1.6-2.5a1.4 1.4 0 1 1 1.4-1.4 1.4 1.4 0 0 1-1.4 1.4Z" fill="currentColor" stroke="none" />
    ),
  },
  {
    key: "whatsapp",
    label: "Share on WhatsApp",
    href: `https://wa.me/?text=${enc(`${SHARE_TEXT} ${REF_LINK}`)}`,
    hover: "hover:bg-[#25D366] hover:text-white hover:border-[#25D366]",
    path: (
      <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.6.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.6-1.2a.4.4 0 0 0 0-.4c0-.1-.6-1.4-.8-1.9s-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.9.8 2.3.7 2.7.6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c0-.1-.2-.2-.5-.3Z" fill="currentColor" stroke="none" />
    ),
  },
  {
    key: "email",
    label: "Share by email",
    href: `mailto:?subject=${enc("Come die with me on DayZ One Life")}&body=${enc(`${SHARE_TEXT}\n\n${REF_LINK}`)}`,
    hover: "hover:bg-ink hover:text-white hover:border-ink",
    path: (
      <>
        <rect x="2.5" y="4.5" width="19" height="15" />
        <path d="m3 6 9 6.5L21 6" />
      </>
    ),
  },
];

function ShareBar() {
  const [note, setNote] = useState("");
  const [canNative, setCanNative] = useState(false);
  // Capability check, not a UA sniff, and it runs AFTER mount so SSR and the first client render
  // agree. `navigator.share` is missing on desktop Chrome/Firefox — the row is the baseline.
  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") setCanNative(true);
  }, []);

  const copy = (message: string) => {
    void navigator.clipboard?.writeText(REF_LINK).catch(() => {});
    setNote(message);
  };

  const field = "border-hairline bg-paper text-ink";
  const copyBtn = "bg-ink text-paper";
  const iconBtn = "border-ink bg-white text-ink";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={REF_LINK}
          aria-label="Your invite link"
          onFocus={(e) => e.currentTarget.select()}
          className={cn("min-w-0 flex-1 border-2 px-3.5 py-3 font-mono text-[15px] tracking-[.02em] outline-none", field)}
        />
        <button
          type="button"
          onClick={() => copy("Link copied ✓")}
          className={cn("min-h-[48px] flex-none px-6 font-display text-sm font-bold uppercase tracking-[.08em]", copyBtn)}
        >
          Copy link
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* ⚠️ Hidden visually below sm — its ~60px pushed the native-share button onto a second
         *  row at 390px. The targets are labelled individually, so nothing is lost. */}
        <span className="sr-only sm:not-sr-only sm:mr-1 sm:font-mono sm:text-[10px] sm:uppercase sm:tracking-[.14em] sm:text-ink-muted">
          Share to
        </span>
        {TARGETS.map((t) =>
          t.href ? (
            <a
              key={t.key}
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
              title={t.label}
              aria-label={t.label}
              className={cn("flex h-11 w-11 flex-none items-center justify-center border-2 transition-colors", iconBtn, t.hover)}
            >
              <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {t.path}
              </svg>
            </a>
          ) : (
            <button
              key={t.key}
              type="button"
              onClick={() => copy("Copied — paste it in Discord ✓")}
              title={t.label}
              aria-label={t.label}
              className={cn("flex h-11 w-11 flex-none items-center justify-center border-2 transition-colors", iconBtn, t.hover)}
            >
              <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {t.path}
              </svg>
            </button>
          ),
        )}
        {canNative && (
          <button
            type="button"
            onClick={() => void navigator.share({ text: SHARE_TEXT, url: REF_LINK }).catch(() => {})}
            className={cn("min-h-[44px] flex-none border-2 px-4 font-mono text-[10px] uppercase tracking-[.1em]", iconBtn)}
          >
            More…
          </button>
        )}
        {/* Live region so the copy confirmation is announced, not just seen. Starts empty, and it
         *  sits INSIDE the icon row — as its own row it added ~20px that pushed this half's fields
         *  out of line with the tokens half opposite. */}
        <span aria-live="polite" className="font-mono text-[10px] uppercase tracking-[.1em] text-ink">
          {note}
        </span>
      </div>
    </div>
  );
}

function SendField() {
  const [to, setTo] = useState("");
  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Send to a verified player…"
        aria-label="Send a token to a verified player"
        className="min-w-0 flex-1 border-2 border-hairline bg-paper px-3.5 py-3 font-mono text-[15px] tracking-[.02em] outline-none placeholder:text-ink-muted"
      />
      <button
        type="submit"
        disabled={!to.trim()}
        className="min-h-[48px] flex-none bg-ink px-6 font-display text-sm font-bold uppercase tracking-[.08em] text-paper disabled:opacity-40"
      >
        Send
      </button>
    </form>
  );
}

/* ══════════════════════ the two halves ══════════════════════
 * ⚠️ VERTICAL BALANCE + HEIGHT. The halves used to be written twice each, per variant, with
 * different internal rhythms, so the columns never lined up and the shorter one left a hole. They
 * now share ONE skeleton, stated once here:
 *
 *     h2 + inline figure  →  one sentence  →  [mt-auto] control  →  hint
 *
 * ⚠️ The figures are INLINE and small. They were display-scale numerals (a 7xl balance mirrored by
 * a 7xl join count), which balanced the columns but cost ~90px per half and pushed the send field
 * and the share bar — the things a player actually came here to use — below the fold. A balance of
 * 3 does not need to be read from across the room. Do not re-promote them.
 *
 * Both halves still align at the top (shared heading row) and at the bottom (`mt-auto` pushes the
 * control group down, so the send field and the link field sit on the same line).
 */

const H2 = "font-display text-2xl font-bold uppercase tracking-[.06em] text-ink";
const HINT = "font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted";

/** The figure, inline beside its heading — present and countable, never a billboard. */
function Figure({ value, label }: { value: number; label: string }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[.14em] text-ink-muted">
      <span className="font-display text-xl font-bold tabular-nums text-ink">{value}</span> {label}
    </p>
  );
}

function Half({ heading, figure, sentence, control, hint }: {
  heading: string;
  figure: React.ReactNode;
  sentence: string;
  control: React.ReactNode;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* ⚠️ `justify-between` only from lg. Below it the halves are full-page-width, and pinning
       *  the figure to the far right edge left it stranded ~700px from the heading it belongs to. */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 lg:justify-between">
        <h2 className={H2}>{heading}</h2>
        {figure}
      </div>
      <p className="mt-2 max-w-md font-sans text-[15px] leading-relaxed text-ink-soft">{sentence}</p>
      {/* mt-auto is the balance mechanism — see the note above. `max-w-xl` only matters BELOW lg,
       *  where the halves stack and an unconstrained field would stretch the full page width. */}
      <div className="mt-auto max-w-xl pt-5 lg:max-w-none">{control}</div>
      <p className={cn(HINT, "mt-3")}>{hint}</p>
    </div>
  );
}

function EarnChips() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only sm:not-sr-only sm:mr-1 sm:font-mono sm:text-[10px] sm:uppercase sm:tracking-[.14em] sm:text-ink-muted">
        Earn by
      </span>
      {EARN_RULES.map((rule) => (
        <span
          key={rule}
          className="flex h-11 items-center border-2 border-ink bg-white px-3 font-mono text-[10px] uppercase tracking-[.06em] text-ink"
        >
          {rule}
        </span>
      ))}
    </div>
  );
}

/* ⚠️ The slab runs EDGE TO EDGE of the page column, exactly like the stage — same `px-6 md:px-10`,
 * no outer padding wrapper. It was previously nested inside a padded `BelowStage`, which inset it
 * from the full-bleed stage above; at 1024px that read as two different page widths stacked.
 *
 * G2 (yellow invite slab) and G3 (dark continuation) were dropped on 2026-07-30 — G1 is the pick.
 * G2 would have needed the "yellow is JoinServers-only" rule amended; that question is now moot. */
function Controls() {
  return (
    <section className="border-y-2 border-ink bg-white">
      {/* ⚠️ The split is `lg` (1024), NOT `md` (768). At md each half is only ~336px of content —
       *  narrower than the share row (label + five 44px targets + the native-share button) and
       *  narrower than "INVITE A SURVIVOR" plus its figure on one line. Both wrapped raggedly for
       *  the whole 768–1023 band. Below lg the halves stack full-width, where everything fits.
       *  Do not move this back to md to "use the space" — the space isn't there. */}
      <div className="grid lg:grid-cols-2">
        <div className="border-b-2 border-ink px-6 py-7 lg:border-b-0 lg:border-r-2 lg:px-10 lg:py-8">
          <Half
            heading="Your tokens"
            figure={<Figure value={BALANCE} label="in hand" />}
            sentence="One token lifts one ban, the moment you spend it."
            control={
              <div className="flex flex-col gap-3">
                <SendField />
                <EarnChips />
              </div>
            }
            hint={SEND_HINT}
          />
        </div>
        <div className="px-6 py-7 lg:px-10 lg:py-8">
          <Half
            heading="Invite a survivor"
            figure={<Figure value={JOINED} label="joined so far" />}
            sentence="Every survivor who verifies on your link pays you a token."
            control={<ShareBar />}
            hint={INVITE_HINT}
          />
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════ the morgue — this player's obituaries ══════════════════════
 * Replaces the `PastLifeCard` grid. Each entry leads with the OBITUARY HEADLINE, linked to the
 * full article at `/obituaries/{slug}`; the timeline moves to its own button. This is where every
 * route into a life lives — the tickets above carry none, by design.
 *
 * ⚠️ THIS SECTION LISTS FILED OBITUARIES ONLY (Steve, 2026-07-30 — asked for explicitly after the
 * alternative was put to him). `apps/newsdesk` files one only for a QUALIFIED death, only past the
 * forward-only `NEWSDESK_SINCE` cutoff, and it can fail permanently at `NEWSDESK_MAX_ATTEMPTS`, so
 * the list is a strict SUBSET of the player's lives and unfiled lives appear nowhere on this page.
 * That is the intended behavior — do not "restore" the missing lives.
 *
 * ⚠️ Its consequence is that ZERO IS A REAL AND COMMON STATE — a player with eleven dead lives and
 * no filed obituary renders an empty section. It gets an explicit empty render, never a bare
 * heading over nothing, and never a count that implies the lives are missing. Loading, failed and
 * empty stay three different renders here as everywhere (`PageHeader`'s `count` union is the
 * pattern); this preview only mocks the empty one.
 *
 * ⚠️ The heading count is FILED OBITUARIES, not lives. "11 lives filed" read as a life count while
 * showing 2 rows; it is now unambiguous.
 */

type Entry = {
  /** Obituary slug, or null when no obituary was ever filed for this life. */
  slug: string | null;
  map: string;
  mapSlug: string;
  lifeNumber: number;
  when: string;
  headline: string;
  lede: string | null;
  facts: { label: string; value: string; hot?: boolean }[];
};

const ENTRIES: Entry[] = [
  {
    slug: "manicdote-livonia-11",
    map: "Livonia",
    mapSlug: "livonia",
    lifeNumber: 11,
    when: "2 days ago",
    headline: "Eleven days of caution, undone in a treeline",
    lede: "He had walked the northern rail since the first frost and never once fired first. The infected did not need him to.",
    facts: [
      { label: "Survived", value: "11d 4h" },
      { label: "Kills", value: "6" },
      { label: "Longest kill", value: "214m" },
      { label: "Cause", value: "Mauled", hot: true },
    ],
  },
  {
    slug: "manicdote-chernarus-6",
    map: "Chernarus",
    mapSlug: "chernarus",
    lifeNumber: 6,
    when: "8 days ago",
    headline: "A trade at the coast, and one rifle too slow",
    lede: "Two survivors met on the Elektro shoreline. Only one of them had already decided how it would end.",
    facts: [
      { label: "Survived", value: "3d 19h" },
      { label: "Kills", value: "2" },
      { label: "Cause", value: "Shot", hot: true },
    ],
  },
];

function TimelineButton({ entry }: { entry: Entry }) {
  return (
    <a
      href={`/players/manicdote/${entry.mapSlug}/lives/${entry.lifeNumber}`}
      className="flex min-h-[44px] flex-none items-center border-2 border-ink bg-white px-4 font-mono text-[10px] uppercase tracking-[.1em] text-ink hover:bg-ink hover:text-paper"
    >
      Timeline <span aria-hidden className="ml-1.5">→</span>
    </a>
  );
}

function Morgue({ viewer, filed }: { viewer: Viewer; filed: boolean }) {
  const entries = filed ? ENTRIES : [];
  return (
    <section className="px-6 py-10 md:px-10 md:py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b-2 border-ink pb-3">
        <h2 className="font-display text-2xl font-bold uppercase tracking-[.06em] text-ink md:text-3xl">
          {viewer === "owner" ? "Your obituaries" : "Obituaries"}
        </h2>
        <p className="font-mono text-[11px] uppercase tracking-[.14em] text-ink-muted">
          <span className="font-display text-xl font-bold tabular-nums text-ink">{entries.length}</span>{" "}
          {entries.length === 1 ? "filed" : "obituaries filed"}
        </p>
      </div>

      {entries.length === 0 && (
        <p className="border-b border-hairline py-8 font-sans text-base leading-relaxed text-ink-soft">
          {viewer === "owner"
            ? "No obituary has been filed for you yet. One is written for every qualified life that ends — survive long enough to qualify, then don't."
            : "No obituary has been filed for this survivor yet."}
        </p>
      )}

      <ul role="list" className="flex flex-col">
        {entries.map((e) => (
          <li key={`${e.mapSlug}-${e.lifeNumber}`} className="border-b border-hairline py-6">
            <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
              {e.map.toUpperCase()} BUREAU · {e.when}
            </p>
            <h3 className="mt-1.5 font-display text-2xl font-bold uppercase leading-[.95] text-ink md:text-3xl">
              {e.slug ? (
                <a href={`/obituaries/${e.slug}`} className="hover:text-red">{e.headline}</a>
              ) : (
                <span className="text-ink-soft">{e.headline}</span>
              )}
            </h3>
            {e.lede ? (
              <p className="mt-2 max-w-2xl font-mono text-[13px] leading-relaxed text-ink-soft">{e.lede}</p>
            ) : (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
                No obituary filed for this life
              </p>
            )}
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                {e.facts.map((f) => (
                  <span key={f.label} className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
                    {f.label} <span className={cn("font-bold", f.hot ? "text-red-deep" : "text-ink")}>{f.value}</span>
                  </span>
                ))}
              </div>
              <TimelineButton entry={e} />
            </div>
          </li>
        ))}
      </ul>

      {entries.length > 0 && (
        <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[.12em] text-ink-muted">
          (existing NumberedPager mounts here — same page size as /obituaries)
        </p>
      )}
    </section>
  );
}

function BelowStage({ rows, viewer, filed }: { rows: Row[]; viewer: Viewer; filed: boolean }) {
  const anyIdle = rows.some((r) => r.state === "idle");
  // ⚠️ NO horizontal padding and NO gap here. Every section below the stage runs the full width of
  // the page column and states its own `px-6 md:px-10`, so the controls measure exactly matches the
  // stage's. A padded wrapper here is what made the slabs read narrower than the hero.
  if (viewer === "public") {
    return (
      <div className="flex flex-col">
        <div className="mx-6 mt-8 border border-hairline bg-white px-3.5 py-3 md:mx-10">
          <p className="font-mono text-[10px] uppercase tracking-[.12em] text-ink-muted">
            Public: FriendButton + totals strip (kills / lives / longest) mount here.
            No tokens, no invite link, no connect panel.
          </p>
        </div>
        <Morgue viewer={viewer} filed={filed} />
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <Controls />
      {anyIdle && (
        <div id="connect" className="mx-6 mt-8 border border-hairline bg-white px-3.5 py-3 md:mx-10">
          <HowToConnect servers={SERVERS} />
        </div>
      )}
      <Morgue viewer={viewer} filed={filed} />
    </div>
  );
}

/* ────────────────────────── harness ────────────────────────── */

type FiledKey = "some" | "none";
const FILED_LABELS: Record<FiledKey, string> = {
  some: "Morgue · 2 filed",
  none: "Morgue · none filed",
};

const VIEWER_LABELS: Record<Viewer, string> = {
  owner: "Owner · at /",
  public: "Public · at /players/manicdote",
};

function Tabs<T extends string>({ value, onChange, labels }: {
  value: T; onChange: (v: T) => void; labels: Record<T, string>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(labels) as T[]).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cn(
            "border-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[.08em]",
            k === value ? "border-red bg-red text-paper" : "border-ink text-ink hover:bg-bone",
          )}
        >
          {labels[k]}
        </button>
      ))}
    </div>
  );
}

export default function DesignPreview() {
  const [viewer, setViewer] = useState<Viewer>("owner");
  const [scenario, setScenario] = useState<ScenarioKey>("mixed");
  const [filed, setFiled] = useState<FiledKey>("some");
  const rows = SCENARIOS[scenario];
  const anyFiled = filed === "some";
  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl">
      <div className="flex flex-col gap-3 border-b-2 border-ink bg-bone px-6 py-4 md:px-10">
        <p className="font-mono text-[10px] uppercase tracking-[.14em] text-ink-muted">
          Throwaway preview — life tickets, round 3 (owner vs public) · mock data
        </p>
        <Tabs value={viewer} onChange={setViewer} labels={VIEWER_LABELS} />
        <Tabs value={scenario} onChange={setScenario} labels={SCENARIO_LABELS} />
        <Tabs value={filed} onChange={setFiled} labels={FILED_LABELS} />
      </div>
      <TicketStage rows={rows} viewer={viewer} />
      <BelowStage rows={rows} viewer={viewer} filed={anyFiled} />
    </main>
  );
}
