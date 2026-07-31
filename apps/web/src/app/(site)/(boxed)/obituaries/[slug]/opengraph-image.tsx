import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getObituary } from "@/lib/api";
import { rapSheetFacts, obituaryHeadlineSize } from "@/lib/obituary-format";
import { monthDayYear } from "@/components/player/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life obituary";

// ⚠️ Keep `import.meta.url` bound to a variable rather than inlined as the second `new URL()`
// argument — see the matching comment in `app/i/[slug]/card/route.tsx` for why.
const here = import.meta.url;
const asset = (name: string) => readFile(new URL(`../../../../../og-assets/${name}`, here));
const dataUri = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [a, oswald, mono, monoBold, wordmarkBuf, skullBuf] = await Promise.all([
    getObituary(slug).catch(() => null),
    asset("oswald-700.ttf"), asset("plex-mono-400.ttf"), asset("plex-mono-700.ttf"),
    asset("wordmark.png"), asset("skull.png"),
  ]);
  const headline = a?.headline ?? "An obituary from DayZ One Life";
  const facts = a ? rapSheetFacts(a) : [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "66px 74px", background: "#0C0C08", color: "#FBFAF2", fontFamily: "Oswald", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "34%", height: 6, background: "#FF1E12" }} />
        <img src={dataUri(skullBuf)} width={470} height={582} style={{ position: "absolute", right: -70, top: 24, opacity: 0.07 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <img src={dataUri(wordmarkBuf)} height={46} />
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontWeight: 700, fontSize: 22, letterSpacing: 2, textTransform: "uppercase", color: "#8A8878" }}>
            <span style={{ color: "#FF1E12" }}>Obituary</span>
            {a && <span>&nbsp;· {a.gamertag} · {monthDayYear(a.deathAt)}</span>}
          </div>
        </div>
        <div style={{ fontSize: obituaryHeadlineSize(headline), fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000 }}>
          {headline}
        </div>
        {facts.length > 0 ? (
          <div style={{ display: "flex", borderTop: "1.5px solid rgba(251,250,242,.16)", paddingTop: 26 }}>
            {facts.map((f, i) => (
              <div key={f.label} style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: i > 0 ? "1px solid rgba(251,250,242,.1)" : "none", paddingLeft: i > 0 ? 24 : 0 }}>
                <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1, color: f.hot ? "#FF1E12" : "#FBFAF2" }}>{f.value}</span>
                <span style={{ fontFamily: "IBM Plex Mono", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: "#8A8878", marginTop: 9 }}>{f.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Oswald", data: oswald, weight: 700, style: "normal" },
        { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
        { name: "IBM Plex Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );
}
