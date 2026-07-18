import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getObituary } from "@/lib/api";
import { rapSheetFacts, dateline } from "@/lib/obituary-format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life obituary";

const asset = (name: string) => readFile(new URL(`./${name}`, import.meta.url));

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

async function heroDataUri(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  try {
    const res = await fetch(`${API_ORIGIN}${imageUrl}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "image/png";
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [article, oswald, mono, monoBold] = await Promise.all([
    getObituary(slug).catch(() => null),
    asset("oswald-700.ttf"),
    asset("plex-mono-400.ttf"),
    asset("plex-mono-700.ttf"),
  ]);
  const hero = await heroDataUri(article?.imageUrl ?? null);

  const headline = article?.headline ?? "An Obituary";
  const line = article ? dateline(article.map, article.deathAt, new Date()) : "ONE LIFE · THE MORGUE";
  const facts = article ? rapSheetFacts(article) : [];

  const textColumn = [
    <div key="head" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, letterSpacing: 2, color: "#FF6B63", textTransform: "uppercase" }}>Obituary · {line}</div>
      <div style={{ display: "flex", fontFamily: "Oswald", fontWeight: 700, fontSize: 78, lineHeight: 1.02, textTransform: "uppercase", marginTop: 20, maxWidth: 1000 }}>{headline}</div>
    </div>,
    <div key="facts" style={{ display: "flex", gap: 48 }}>
      {facts.map((f) => (
        <div key={f.label} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: "Oswald", fontWeight: 700, fontSize: 44, color: f.hot ? "#FF6B63" : "#FBFAF2" }}>{f.value}</div>
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 18, letterSpacing: 1.5, color: "#8A8878", textTransform: "uppercase", marginTop: 4 }}>{f.label}</div>
        </div>
      ))}
    </div>,
  ];

  return new ImageResponse(
    hero ? (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0C0C08", color: "#FBFAF2" }}>
        <img src={hero} style={{ display: "flex", width: "38%", height: "100%", objectFit: "cover" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64 }}>
          {textColumn}
        </div>
      </div>
    ) : (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0C0C08", color: "#FBFAF2", padding: 64 }}>
        {textColumn}
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
