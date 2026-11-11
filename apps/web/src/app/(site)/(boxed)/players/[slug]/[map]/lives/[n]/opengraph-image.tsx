import { ImageResponse } from "next/og";
import { getPlayerLife } from "@/lib/api";
import { mapLabel, formatDuration } from "@/components/player/format";
import { causeLabel } from "@/lib/cause-format";
import { loadCardAssets, OG_SIZE, PAPER, DIM, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life life record";

export default async function OgImage({ params }: { params: Promise<{ slug: string; map: string; n: string }> }) {
  const { slug, map, n } = await params;
  const num = Number.parseInt(n, 10);
  const [data, assets] = await Promise.all([
    Number.isFinite(num) ? getPlayerLife(slug, map, num).catch(() => null) : Promise.resolve(null),
    loadCardAssets(),
  ]);

  const gamertag = data?.gamertag ?? "A One Life record";
  const gtSize = gamertag.length > 12 ? 84 : gamertag.length > 9 ? 104 : 124;
  const alive = data ? data.life.endedAt === null : false;
  const retired = data?.life.endReason === "server_retired";
  const stats: CardStat[] = data
    ? [
        { label: "time alive", value: formatDuration(data.life.playtimeSeconds), hot: false },
        { label: "kills", value: String(data.kills.length), hot: data.kills.length > 0 },
        { label: "sessions", value: String(data.sessions.length), hot: false },
        { label: "status", value: alive ? "ALIVE" : retired ? "RETIRED" : "DEAD", hot: !alive && !retired },
      ]
    : [];

  // The public death's label (death-verdict spec 7), hedged on the server. An old payload with no
  // label keeps the coarse word.
  const causeText = data?.verdict?.label || (data?.life.deathCause ? causeLabel(data.life.deathCause) : null);
  // ⚠️ A pending death ("Awaiting the record", or the bare coarse word) becomes its real cause a few
  // minutes later. Next would cache this card for a year; a scraper that caught the pending one
  // would keep it. A minute lets the next scrape pick up the verdict.
  const pending = data?.verdict?.status === "pending";

  return new ImageResponse(
    (
      <CardShell
        assets={assets}
        stats={stats}
        kicker={
          data ? (
            <>
              <span style={{ color: RED }}>Life {data.life.lifeNumber}</span>
              <span>&nbsp;· {mapLabel(data.map)}</span>
            </>
          ) : undefined
        }
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: gtSize, fontWeight: 700, lineHeight: 1, letterSpacing: -1, color: PAPER }}>{gamertag}</div>
          {data && !alive && !retired && causeText && (
            <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, color: DIM, marginTop: 26, textTransform: "uppercase" }}>
              {causeText}
            </div>
          )}
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts, ...(pending ? { headers: { "cache-control": "public, max-age=60, must-revalidate" } } : {}) },
  );
}
