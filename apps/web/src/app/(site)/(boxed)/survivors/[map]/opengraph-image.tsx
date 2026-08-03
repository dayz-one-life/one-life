import { ImageResponse } from "next/og";
import { getSurvivors } from "@/lib/api";
import { loadCardAssets, OG_SIZE, PAPER, DIM, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life survivors board";

const titleCase = (slug: string) => slug.replace(/\b\w/g, (c) => c.toUpperCase());

export default async function OgImage({ params }: { params: Promise<{ map: string }> }) {
  const { map } = await params;
  const [data, assets] = await Promise.all([
    getSurvivors({ slug: map, page: 1 }).catch(() => null),
    loadCardAssets(),
  ]);
  // ⚠️ `map` is attacker-controlled URL text. When `getSurvivors` returns null (unknown/rigged
  // slug), the card MUST NOT echo it back — titleCase(map) would render an official-looking
  // "Top <anything> survivors" card for any string a caller puts in the URL. The failure path
  // gets a neutral, static headline instead; only the success path uses the map label.
  const stats: CardStat[] = data
    ? [
        { label: "on the board", value: String(data.total), hot: true },
        { label: "ranking", value: "TIME ALIVE", hot: false },
        { label: "lives each", value: "1", hot: false },
      ]
    : [];
  const headline = data ? `Top ${titleCase(map)} survivors` : "Survivors";
  const leader = data?.rows[0]?.gamertag ?? null;

  return new ImageResponse(
    (
      <CardShell assets={assets} stats={stats} kicker={<span style={{ color: RED }}>Survivors</span>}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000, color: PAPER }}>
            {headline}
          </div>
          {leader && (
            <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, color: DIM, marginTop: 26 }}>
              <span style={{ fontWeight: 700, color: PAPER }}>{leader}</span>&nbsp;leads the pack
            </div>
          )}
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
