import { ImageResponse } from "next/og";
import { getPlayerPage } from "@/lib/api";
import { heroStats, monthYear } from "@/components/player/format";
import { loadCardAssets, OG_SIZE, PAPER, DIM } from "@/lib/og/assets";
import { CardShell } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life survivor profile";

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [page, assets] = await Promise.all([getPlayerPage(slug).catch(() => null), loadCardAssets()]);
  const gamertag = page?.gamertag ?? "Unknown survivor";
  const stats = page ? heroStats(page.totals) : [];
  const since = page?.firstSeenAt ? monthYear(page.firstSeenAt) : null;
  const gtSize = gamertag.length > 12 ? 84 : gamertag.length > 9 ? 104 : 124;

  return new ImageResponse(
    (
      <CardShell assets={assets} stats={stats}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: gtSize, fontWeight: 700, lineHeight: 1, letterSpacing: -1, color: PAPER }}>{gamertag}</div>
          {since && (
            <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, color: DIM, marginTop: 26 }}>
              First seen&nbsp;<span style={{ fontWeight: 700, color: PAPER, textTransform: "uppercase" }}>{since}</span>
            </div>
          )}
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
