import { ImageResponse } from "next/og";
import { loadCardAssets, OG_SIZE } from "@/lib/og/assets";
import { CardShell } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life — hardcore permadeath DayZ";

export default async function OgImage() {
  const assets = await loadCardAssets();
  return new ImageResponse(
    (
      <CardShell
        assets={assets}
        kicker={<span>dayzonelife.com</span>}
        stats={[
          { label: "life per server", value: "1", hot: true },
          { label: "ban when it ends", value: "24H", hot: false },
          { label: "second chances", value: "0", hot: false },
        ]}
      >
        <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000 }}>
          One life. One death. The record stands.
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
