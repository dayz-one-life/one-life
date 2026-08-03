import { ImageResponse } from "next/og";
import { getObituary } from "@/lib/api";
import { rapSheetFacts, obituaryHeadlineSize } from "@/lib/obituary-format";
import { monthDayYear } from "@/components/player/format";
import { loadCardAssets, OG_SIZE, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life obituary";

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [a, assets] = await Promise.all([getObituary(slug).catch(() => null), loadCardAssets()]);
  const headline = a?.headline ?? "An obituary from DayZ One Life";
  const stats: CardStat[] = a ? rapSheetFacts(a) : [];

  return new ImageResponse(
    (
      <CardShell
        assets={assets}
        stats={stats}
        kicker={
          <>
            <span style={{ color: RED }}>Obituary</span>
            {a && <span>&nbsp;· {a.gamertag} · {monthDayYear(a.deathAt)}</span>}
          </>
        }
      >
        <div style={{ fontSize: obituaryHeadlineSize(headline), fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000 }}>
          {headline}
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
