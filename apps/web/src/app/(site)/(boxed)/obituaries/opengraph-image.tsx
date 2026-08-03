import { ImageResponse } from "next/og";
import { getSiteStatsCached } from "@/lib/api";
import { loadCardAssets, OG_SIZE, DIM, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life obituaries";

export default async function OgImage() {
  const [stats, assets] = await Promise.all([
    getSiteStatsCached().catch(() => null),
    loadCardAssets(),
  ]);
  const band: CardStat[] = stats
    ? [
        { label: "deaths on record", value: String(stats.deaths), hot: true },
        { label: "obituary each", value: "1", hot: false },
        { label: "retractions", value: "0", hot: false },
      ]
    : [];

  return new ImageResponse(
    (
      <CardShell assets={assets} stats={band} kicker={<span style={{ color: RED }}>The Morgue</span>}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 110, fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase" }}>
            The obituaries
          </div>
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, color: DIM, marginTop: 26, textTransform: "uppercase" }}>
            Every qualified death gets its write-up
          </div>
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
