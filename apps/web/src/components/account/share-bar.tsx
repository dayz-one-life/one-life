"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The invite share bar.
 *
 * ⚠️ Sharing is not one button. A survivor's people are on Discord, on X, in a group chat — so
 * the link itself is a read-only field and every place they might actually paste it gets its own
 * target.
 *
 * ⚠️ Discord has NO web share intent — there is no URL that opens a compose box with text in it.
 * So the Discord target is an honest copy-to-clipboard whose label says so ("Copied — paste it in
 * Discord"). Do not "fix" this by inventing a discord.com/share URL; it does not exist.
 *
 * ⚠️ The native sheet (`navigator.share`) is the right primary on a phone, but it is ABSENT on
 * desktop Chrome/Firefox, so it can never be the only way to share. It is rendered as an EXTRA
 * button, mounted only after the capability check runs client-side — never in place of the row.
 */

const SHARE_TEXT = "One life. One death. One 24h ban. Come die with me on DayZ One Life.";

type Target = {
  key: string;
  label: string;
  /** null → this target copies to the clipboard instead of opening a URL (Discord). */
  href: ((link: string) => string) | null;
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
    href: (link) => `https://x.com/intent/tweet?url=${enc(link)}&text=${enc(SHARE_TEXT)}`,
    hover: "hover:bg-ink hover:text-white hover:border-ink",
    path: <path d="M3 3h4.2l4.6 6.2L17.1 3H21l-6.9 7.8L21.4 21h-4.2l-5-6.7L6 21H2.1l7.3-8.3L3 3Zm3 1.6 10.4 14.8h1.7L7.7 4.6H6Z" fill="currentColor" stroke="none" />,
  },
  {
    key: "reddit",
    label: "Share on Reddit",
    href: (link) => `https://www.reddit.com/submit?url=${enc(link)}&title=${enc(SHARE_TEXT)}`,
    hover: "hover:bg-[#FF4500] hover:text-white hover:border-[#FF4500]",
    path: (
      <path d="M22 12a2 2 0 0 0-3.4-1.4 9.9 9.9 0 0 0-5-1.5l.9-4 2.8.6a1.7 1.7 0 1 0 .2-1.4l-3.5-.8a.7.7 0 0 0-.8.5l-1.1 5.1a9.9 9.9 0 0 0-5 1.5A2 2 0 1 0 3.6 14a4 4 0 0 0 0 .6c0 3.3 3.8 6 8.4 6s8.4-2.7 8.4-6a4 4 0 0 0 0-.6A2 2 0 0 0 22 12ZM8.3 13.4a1.4 1.4 0 1 1 1.4 1.4 1.4 1.4 0 0 1-1.4-1.4Zm7.6 3.9a5.5 5.5 0 0 1-3.9 1.2 5.5 5.5 0 0 1-3.9-1.2.5.5 0 0 1 .7-.7 4.6 4.6 0 0 0 3.2.9 4.6 4.6 0 0 0 3.2-.9.5.5 0 0 1 .7.7Zm-1.6-2.5a1.4 1.4 0 1 1 1.4-1.4 1.4 1.4 0 0 1-1.4 1.4Z" fill="currentColor" stroke="none" />
    ),
  },
  {
    key: "whatsapp",
    label: "Share on WhatsApp",
    href: (link) => `https://wa.me/?text=${enc(`${SHARE_TEXT} ${link}`)}`,
    hover: "hover:bg-[#25D366] hover:text-white hover:border-[#25D366]",
    path: (
      <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.6.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.6-1.2a.4.4 0 0 0 0-.4c0-.1-.6-1.4-.8-1.9s-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.9.8 2.3.7 2.7.6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c0-.1-.2-.2-.5-.3Z" fill="currentColor" stroke="none" />
    ),
  },
  {
    key: "email",
    label: "Share by email",
    href: (link) =>
      `mailto:?subject=${enc("Come die with me on DayZ One Life")}&body=${enc(`${SHARE_TEXT}\n\n${link}`)}`,
    hover: "hover:bg-ink hover:text-white hover:border-ink",
    path: (
      <>
        <rect x="2.5" y="4.5" width="19" height="15" />
        <path d="m3 6 9 6.5L21 6" />
      </>
    ),
  },
];

export function ShareBar({ link }: { link: string }) {
  const [note, setNote] = useState("");
  const [canNative, setCanNative] = useState(false);
  // Capability check, not a UA sniff, and it runs AFTER mount so SSR and the first client render
  // agree. `navigator.share` is missing on desktop Chrome/Firefox — the row is the baseline.
  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") setCanNative(true);
  }, []);

  const copy = (message: string) => {
    void navigator.clipboard?.writeText(link).catch(() => {});
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
          value={link}
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
              href={t.href(link)}
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
            onClick={() => void navigator.share({ text: SHARE_TEXT, url: link }).catch(() => {})}
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
