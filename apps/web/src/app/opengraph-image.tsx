import { ImageResponse } from "next/og";
import { getSiteStatsCached } from "@/lib/api";
import type { SiteStats } from "@/lib/types";
import { loadCardAssets, OG_SIZE, PAPER, DIM, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life — hardcore permadeath DayZ";

/**
 * The bottom band: static format facts, never data. They answer what a cold DayZ player actually
 * needs — what the format is, and what platform it runs on — and being static they cannot go
 * stale or contradict the site.
 *
 * ⚠️ The unban-token mechanic is deliberately ABSENT and this is not an oversight. Naming the way
 * back in, in the first impression, softens the exact promise that makes the server distinctive;
 * Rule 03 on the home page covers it instead. The row this replaced claimed "0 second chances",
 * which the token economy flatly contradicts — one token lifts one ban, and tokens are both
 * earned and sold. Re-adding either claim reverses a decision rather than filling a gap.
 */
export const FORMAT_STATS: CardStat[] = [
  { label: "life per server", value: "1", hot: true },
  { label: "ban when it ends", value: "24H", hot: false },
  { label: "hardcore permadeath", value: "XBOX", hot: false },
];

const EVERGREEN_HEADLINE = "One life. One death. The record stands.";

export type HomeCardState =
  | { kind: "ledger"; deaths: string; alive: string }
  | { kind: "evergreen"; headline: string };

/**
 * Decide what the card says. Split out from the render so it can be ASSERTED — a test that only
 * awaits the route gets a PNG and cannot tell a body count from an evergreen headline.
 *
 * ⚠️ A failed fetch must never reach the card as an authoritative `0` (the repo's most-repeated
 * bug class, on its most-shared artifact). `null` covers both the rejection and the zero: a real
 * zero body count is true but sells nothing, so it renders as "nothing to report yet" rather than
 * as a boast about a server where nobody has died. The two states are indistinguishable on the
 * card by design, and distinguishable here in the code.
 */
export function homeCardState(stats: SiteStats | null): HomeCardState {
  if (!stats || stats.deaths <= 0) return { kind: "evergreen", headline: EVERGREEN_HEADLINE };
  const fmt = (n: number) => n.toLocaleString("en-US");
  return { kind: "ledger", deaths: fmt(stats.deaths), alive: fmt(stats.alive) };
}

export default async function OgImage() {
  const [stats, assets] = await Promise.all([
    getSiteStatsCached().catch(() => null),
    loadCardAssets(),
  ]);
  const state = homeCardState(stats);

  return new ImageResponse(
    (
      <CardShell assets={assets} kicker={<span>dayzonelife.com</span>} stats={FORMAT_STATS}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000, color: PAPER }}>
            {state.kind === "ledger" ? (
              <>
                Deaths to date:&nbsp;<span style={{ color: RED }}>{state.deaths}</span>
              </>
            ) : (
              state.headline
            )}
          </div>
          {state.kind === "ledger" && (
            <div style={{ display: "flex", fontSize: 40, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: DIM, marginTop: 22 }}>
              Still standing:&nbsp;<span style={{ color: PAPER }}>{state.alive}</span>
            </div>
          )}
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
