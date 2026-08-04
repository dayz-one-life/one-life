import { describe, it, expect, vi } from "vitest";
import { SITE_CARD_IMAGES } from "@/lib/seo";

// The home page module reaches the data layer and the cookie jar at import time through its
// component tree. This suite only wants its `metadata` export, so stub both.
// ⚠️ `then` must stay undefined: `await import(...)` treats a namespace with a callable `then`
// as a thenable and hangs forever waiting for a resolve this stub never calls.
vi.mock("@/lib/api", () => new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : vi.fn()) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));

/**
 * ⚠️ Regression pin for the v0.73.0 gap: these four routes declare their own `openGraph` block
 * and have NO colocated `opengraph-image.tsx`, which means Next.js does not attach the root
 * card — they shipped to production unfurling with no image at all. Home is the most-shared
 * URL on the site. If one of these fails, restore the `images` entry; do not relax it.
 *
 * A page that GROWS its own colocated `opengraph-image.tsx` should be removed from this list
 * rather than kept — the file convention wins and restating the site card would override it.
 */
const PAGES = [
  { name: "home", load: () => import("./page") },
  { name: "about", load: () => import("./about/page") },
  { name: "terms", load: () => import("./terms/page") },
  { name: "privacy", load: () => import("./privacy/page") },
];

describe.each(PAGES)("$name page share card", ({ load }) => {
  it("names the site card in openGraph, so the page does not unfurl imageless", async () => {
    const { metadata } = (await load()) as { metadata: { openGraph?: { images?: unknown } } };
    expect(metadata.openGraph?.images).toEqual(SITE_CARD_IMAGES);
  });

  // Twitter tags do not inherit openGraph images here: the root layout declares
  // `twitter: { card: "summary_large_image" }` and nothing else, so a page that sets only
  // `openGraph.images` still advertises a large-image card with no image to fill it.
  it("names the site card for twitter too", async () => {
    const { metadata } = (await load()) as { metadata: { twitter?: { images?: unknown } } };
    expect(metadata.twitter?.images).toEqual(SITE_CARD_IMAGES);
  });
});
