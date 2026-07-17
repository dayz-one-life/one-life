import type { AccountStatus } from "@/lib/account-status";
import type { Server, ServerStanding } from "@/lib/types";
import { banCountdown, formatDuration, mapLabel } from "@/components/player/format";

export type PillTone = "red" | "yellow" | "dim" | "muted";
export type PillLine = { text: string; tone: PillTone };

/** First letter of a display name for the avatar disc. */
export function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/** Local HH:MM time-of-death, taken from the ban timestamp (bans are cut on death). */
export function diedAtLabel(bannedAt: string): string {
  const d = new Date(bannedAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** One rail card per active slugged server, merged with the viewer's standing by slug. */
export type ServerCardData = {
  slug: string;
  map: string;
  state: "alive" | "banned" | "idle";
  alive: { timeAliveSeconds: number; kills: number } | null;
  ban: { banId: number; bannedAt: string; expiresAt: string | null; liftPending: boolean } | null;
};

export function serverCards(servers: Server[], standing: ServerStanding[]): ServerCardData[] {
  return servers
    .filter((s): s is Server & { slug: string } => s.slug !== null)
    .map((s) => {
      const st = standing.find((x) => x.slug === s.slug);
      return {
        slug: s.slug,
        map: s.map,
        state: st?.state ?? "idle",
        alive: st?.alive ? { timeAliveSeconds: st.alive.timeAliveSeconds, kills: st.alive.kills } : null,
        ban: st?.ban
          ? { banId: st.ban.banId, bannedAt: st.ban.bannedAt, expiresAt: st.ban.expiresAt, liftPending: st.ban.liftPending }
          : null,
      };
    });
}

/** The mono fact line under a server card's name (CSS uppercases it). */
export function serverFactLine(card: ServerCardData): string {
  if (card.state === "alive" && card.alive) {
    return `Qualified · ${formatDuration(card.alive.timeAliveSeconds)} this life · ${card.alive.kills} kill${card.alive.kills === 1 ? "" : "s"}`;
  }
  if (card.state === "banned" && card.ban) return `Died ${diedAtLabel(card.ban.bannedAt)}`;
  return "Spawn in any time. First 5 minutes are free.";
}

/** User-facing label for token-panel API error codes. */
export function transferErrorLabel(code: string): string {
  if (code === "not_verified") return "Not a verified player";
  if (code === "insufficient_tokens") return "Not enough tokens";
  if (code === "self_transfer") return "That's you";
  if (code === "already_set") return "Already set";
  return "Something went wrong";
}

/** The pill's one status line, most urgent first: banned > pending > unlinked > alive > idle. */
export function pillStatus(status: AccountStatus, cards: ServerCardData[], now: Date): PillLine {
  const banned = cards.filter((c) => c.state === "banned" && c.ban);
  if (banned.length > 0) {
    const soonest = banned
      .slice()
      .sort((a, b) => new Date(a.ban!.expiresAt ?? 0).getTime() - new Date(b.ban!.expiresAt ?? 0).getTime())[0]!;
    const cd = banCountdown(soonest.ban!.expiresAt, now);
    return { text: cd ? `${mapLabel(soonest.map)} ban lifts in ${cd}` : `${mapLabel(soonest.map)} banned`, tone: "red" };
  }
  if (status.kind === "pending") {
    const ch = status.link.challenge;
    if (ch && !ch.expired) return { text: `Verify: ${ch.progressIndex}/${ch.sequence.length} done`, tone: "yellow" };
    return { text: "Verification expired", tone: "yellow" };
  }
  if (status.kind === "unlinked") return { text: "Link your gamertag →", tone: "dim" };
  const alive = cards.filter((c) => c.state === "alive" && c.alive);
  if (alive.length > 0) {
    const longest = alive.slice().sort((a, b) => b.alive!.timeAliveSeconds - a.alive!.timeAliveSeconds)[0]!;
    return { text: `${mapLabel(longest.map)} · ${formatDuration(longest.alive!.timeAliveSeconds)} this life`, tone: "dim" };
  }
  return { text: "No active life", tone: "muted" };
}
