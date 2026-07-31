import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { isStorableSlug } from "@/lib/referral-cookie";

export const runtime = "nodejs";

// ⚠️ Do not inline `import.meta.url` as the second `new URL()` argument: Vite's static
// asset-URL analyzer specially rewrites that exact AST shape and mishandles a *dynamic*
// (template-literal) first argument under the vitest/jsdom test transform — it silently
// resolves to a wrong or `undefined`-suffixed path. Binding it to a variable first dodges the
// analyzer; Next's production runtime resolves this URL natively either way.
const here = import.meta.url;
const asset = (name: string) => readFile(new URL(`../../../../og-assets/${name}`, here));
const dataUri = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

const DARK = "#0C0C08", PAPER = "#FBFAF2", RED = "#FF1E12", DIM = "#8A8878";

/** The invite unfurl card (v0.69 spec §3, design a3b/K5). Satori-safe: flex only, no shadows. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const [oswald, mono, monoBold, wordmarkBuf, skullBuf] = await Promise.all([
    asset("oswald-700.ttf"), asset("plex-mono-400.ttf"), asset("plex-mono-700.ttf"),
    asset("wordmark.png"), asset("skull.png"),
  ]);
  const name = isStorableSlug(slug) ? slug.toUpperCase() : null;
  const kicker = name ? `${name} IS OUT THERE WAITING` : "SOMEONE IS OUT THERE WAITING";
  // Long gamertags drop the kicker a step instead of wrapping — same trick as the dossier card.
  const kickerSize = kicker.length > 34 ? 18 : 22;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: DARK, color: PAPER, fontFamily: "Oswald" }}>
        {/* left column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "60px 56px 60px 74px", position: "relative" }}>
          <img src={dataUri(skullBuf)} width={470} height={582} style={{ position: "absolute", left: -120, bottom: -160, opacity: 0.06 }} />
          <img src={dataUri(wordmarkBuf)} height={46} style={{ alignSelf: "flex-start" }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "IBM Plex Mono", fontSize: kickerSize, fontWeight: 700, letterSpacing: 3, color: DIM, textTransform: "uppercase" }}>{kicker}</div>
            <div style={{ fontSize: 126, fontWeight: 700, lineHeight: 0.94, letterSpacing: -1, textTransform: "uppercase", marginTop: 18, display: "flex", flexDirection: "column" }}>
              <span style={{ display: "flex" }}>Come&nbsp;<span style={{ color: RED }}>die</span></span>
              <span>with me.</span>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: "IBM Plex Mono", fontSize: 17, color: DIM, letterSpacing: 0.5, textTransform: "uppercase" }}>Every life ends in an obituary. Yours is waiting.</span>
            <span style={{ fontFamily: "IBM Plex Mono", fontSize: 17, fontWeight: 700, letterSpacing: 1.5, color: PAPER, textTransform: "uppercase", marginLeft: 24 }}>dayzonelife.com</span>
          </div>
        </div>
        {/* red spine: three equal thirds */}
        <div style={{ width: 300, background: RED, color: PAPER, display: "flex", flexDirection: "column", padding: "36px 44px" }}>
          {[
            ["One life", "No respawns", false],
            ["One death", "It counts", true],
            ["24h ban", "Then earn it back", true],
          ].map(([label, sub, divider]) => (
            <div key={label as string} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", borderTop: divider ? "2px solid rgba(251,250,242,.35)" : "none" }}>
              <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>
              <span style={{ fontFamily: "IBM Plex Mono", fontSize: 15, letterSpacing: 2, textTransform: "uppercase", opacity: 0.75, marginTop: 8 }}>{sub}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200, height: 630,
      fonts: [
        { name: "Oswald", data: oswald, weight: 700, style: "normal" },
        { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
        { name: "IBM Plex Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );
}
