import { readFile } from "node:fs/promises";

// ⚠️ Keep `import.meta.url` bound to a variable rather than inlined as the second `new URL()`
// argument — Vite's asset-URL analyzer rewrites an inlined `import.meta.url` under the vitest
// transform and the path breaks. See the matching comment in `app/i/[slug]/card/route.tsx`.
const here = import.meta.url;
const asset = (name: string) => readFile(new URL(`../../og-assets/${name}`, here));

export const DARK = "#0C0C08";
export const PAPER = "#FBFAF2";
export const RED = "#FF1E12";
export const DIM = "#8A8878";

export const OG_SIZE = { width: 1200, height: 630 };

const dataUri = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

export type CardAssets = {
  fonts: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[];
  wordmark: string;
  skull: string;
};

/** One await for everything a card needs: the three fonts (ready to spread into
 *  `ImageResponse`'s `fonts` option) plus the wordmark and skull as data URIs. */
export async function loadCardAssets(): Promise<CardAssets> {
  const [oswald, mono, monoBold, wordmarkBuf, skullBuf] = await Promise.all([
    asset("oswald-700.ttf"), asset("plex-mono-400.ttf"), asset("plex-mono-700.ttf"),
    asset("wordmark.png"), asset("skull.png"),
  ]);
  return {
    fonts: [
      { name: "Oswald", data: oswald, weight: 700, style: "normal" },
      { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
      { name: "IBM Plex Mono", data: monoBold, weight: 700, style: "normal" },
    ],
    wordmark: dataUri(wordmarkBuf),
    skull: dataUri(skullBuf),
  };
}
