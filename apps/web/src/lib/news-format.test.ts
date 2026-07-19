import { describe, it, expect } from "vitest";
import {
  newsHref, newsArticleHref, newsDateline, newsShowingLine, newsUpdateDate,
  triggerLabel, newsDossierFacts,
} from "./news-format";
import type { NewsArticle } from "./types";

const article = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  slug: "standing-dead-still-standing-somewhere-gabefox101-7-3",
  trigger: "standing_dead", gamertag: "GabeFox101", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Still Standing, Somewhere", lede: "L", tags: ["News"],
  subjectCount: 1, createdAt: "2026-07-14T00:00:00Z", body: "B", bodyBlocks: null,
  pullQuote: null, imageUrl: null, imageCaption: null, retracted: false,
  timeAliveSeconds: 5600, kills: 0, idleSeconds: 259200, spanSeconds: null,
  subjects: [{ gamertag: "GabeFox101", mapSlug: "chernarus", lifeNumber: 3 }],
  subjectStatus: { kind: "idle", idleDaysAtPublication: 3 },
  ...over,
});

describe("hrefs", () => {
  it("omits ?page for page 1", () => {
    expect(newsHref(1)).toBe("/news");
    expect(newsHref(3)).toBe("/news?page=3");
  });
  it("builds an interior href", () => {
    expect(newsArticleHref("a-b-c")).toBe("/news/a-b-c");
  });
});

describe("newsDateline", () => {
  it("is map-only — never a coordinate", () => {
    expect(newsDateline("chernarusplus", "2026-07-12T00:00:00Z", new Date("2026-07-14T00:00:00Z")))
      .toBe("CHERNARUS BUREAU · 2 days ago");
  });
});

describe("newsShowingLine", () => {
  // THE ARG-ORDER PIN. Signature is (page, total, pageSize) — the BIRTH order, per spec §9.
  // obituaryShowingLine is (page, pageSize, total), and every argument is a number, so a swap is
  // type-silent. The assertion below distinguishes them: reading (2, 7, 3) in the obituary order
  // renders "Showing 3–3 of 3 filed" — a different range AND a different total.
  it("follows the BIRTH argument order (page, total, pageSize)", () => {
    expect(newsShowingLine(2, 7, 3)).toBe("Showing 4–6 of 7 filed");
  });
  it("clamps the final partial page", () => {
    expect(newsShowingLine(3, 7, 3)).toBe("Showing 7–7 of 7 filed");
  });
  it("reads sanely with nothing filed", () => {
    expect(newsShowingLine(1, 0, 20)).toBe("Showing 0–0 of 0 filed");
  });
});

describe("newsUpdateDate", () => {
  it("formats in UTC, deterministically — never toLocaleDateString", () => {
    expect(newsUpdateDate("2026-07-14T23:30:00Z")).toBe("14 JUL 2026");
  });
});

describe("triggerLabel", () => {
  it("names both desks", () => {
    expect(triggerLabel("standing_dead")).toBe("The Standing Dead");
    expect(triggerLabel("long_form")).toBe("The Long Form");
  });
});

describe("newsDossierFacts", () => {
  it("reports PLAYED time and idle time as separate, differently-labelled figures", () => {
    const facts = newsDossierFacts(article());
    expect(facts).toEqual([
      { label: "Played", value: "1h 33m", hot: false },
      { label: "Kills", value: "0", hot: false },
      { label: "Life", value: "3 · Chernarus", hot: false },
      { label: "Idle", value: "3 days", hot: true },
    ]);
  });

  it("swaps in the Long Form figures and never emits an idle row", () => {
    const facts = newsDossierFacts(article({
      trigger: "long_form", subjectCount: 2, idleSeconds: null, spanSeconds: 27, kills: 1,
    }));
    expect(facts).toEqual([
      { label: "Played", value: "1h 33m", hot: false },
      { label: "Kills", value: "1", hot: false },
      { label: "Life", value: "3 · Chernarus", hot: false },
      { label: "Subjects", value: "2", hot: true },
      { label: "Span", value: "27s", hot: false },
    ]);
    expect(facts.some((f) => f.label === "Idle")).toBe(false);
  });

  it("emits no distance, no landmark and no coordinate-shaped value", () => {
    const all = [...newsDossierFacts(article()), ...newsDossierFacts(article({ trigger: "long_form", spanSeconds: 27, idleSeconds: null }))];
    // METRES NEVER APPEAR ON A NEWS DOSSIER. The rail used to read /\bm\b/, which can never match:
    // `\b` needs a word/non-word transition and there is none between a digit and "m", so it
    // returned false for "412m" and "1h 33m" alike — the same vacuity class Task 1 exists to
    // repair. /\d\s?m\b/ does match, but it also matches a legitimate DURATION (formatDuration
    // renders 5600s as "1h 33m"), so it is asserted over the non-duration facts only.
    const DURATION_LABELS = new Set(["Played", "Idle", "Span"]);
    for (const f of all) {
      expect(f.value).not.toMatch(/\d{3,5}\.\d/);
      if (!DURATION_LABELS.has(f.label)) expect(f.value).not.toMatch(/\d\s?m\b/);
    }
    // A distance leak would arrive as its own fact, so no such label may exist either.
    expect(all.some((f) => /distance|metre|meter|range/i.test(f.label))).toBe(false);
  });
});
