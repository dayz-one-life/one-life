import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NewsArticleView, type NewsTimeline } from "./news-article";
import type { NewsArticle } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...(props as object)} alt="" />,
}));

const now = new Date("2026-07-14T00:00:00Z");

const article = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  slug: "standing-dead-still-standing-somewhere-gabefox101-7-3",
  trigger: "standing_dead", gamertag: "GabeFox101", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Still Standing, Somewhere",
  lede: "Nobody has had word since Tuesday.", tags: ["News", "Chernarus", "The Standing Dead"],
  subjectCount: 1, createdAt: "2026-07-12T00:00:00Z",
  body: "Flat fallback paragraph.\n\nSecond flat paragraph.",
  bodyBlocks: null, pullQuote: { text: "He was here on Tuesday.", attribution: "a quartermaster" },
  imageUrl: null, imageCaption: null, retracted: false,
  timeAliveSeconds: 5600, kills: 0, idleSeconds: 259200, spanSeconds: null,
  subjects: [{ gamertag: "GabeFox101", mapSlug: "chernarus", lifeNumber: 3 }],
  subjectStatus: { kind: "idle", idleDaysAtPublication: 3 },
  ...over,
});

// Fully typed, no cast: TimelineEvent's `birth` arm is
// { kind, at: Date, marker: "gray", timeLabel, title, line }.
const view = (alive: boolean): LifeTimelineView => ({
  alive,
  hero: { timeAliveSeconds: 5600, kills: 0, longestKillMeters: null, sessions: 2, qualified: true },
  events: [{
    kind: "birth", at: new Date("2026-07-11T00:00:00Z"), marker: "gray",
    timeLabel: "0h 00m IN", title: "Washed ashore", line: "Chernarus",
  }],
});

describe("NewsArticleView — the masthead and the standard furniture", () => {
  it("renders headline, dateline, lede, dossier, pull quote, tags and the related rail", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(screen.getByRole("heading", { level: 1, name: /Still Standing, Somewhere/ })).toBeInTheDocument();
    expect(screen.getByText(/CHERNARUS BUREAU/)).toBeInTheDocument();
    expect(screen.getByText("Nobody has had word since Tuesday.")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();          // dossier
    expect(screen.getByText(/He was here on Tuesday/)).toBeInTheDocument();
    expect(screen.getByText("The Standing Dead")).toBeInTheDocument();  // a tag
    expect(screen.getByRole("link", { name: "GabeFox101" })).toHaveAttribute("href", "/players/gabefox101");
  });

  it("renders no hero image when imageUrl is absent", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders the hero image and its caption when one exists", () => {
    render(<NewsArticleView
      article={article({ imageUrl: "/media/heroes/x.png", imageCaption: "A ROOM, RECENTLY LEFT" })}
      more={[]} timelines={[]} now={now} />);
    expect(document.querySelector("img")).toBeTruthy();
    expect(screen.getByText("A ROOM, RECENTLY LEFT")).toHaveClass("border-ink");
  });
});

describe("NewsArticleView — the rich body", () => {
  it("renders the FLAT fallback when bodyBlocks is null", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(screen.getByText("Flat fallback paragraph.")).toBeInTheDocument();
    expect(screen.getByText("Second flat paragraph.")).toBeInTheDocument();
  });

  // NEWS IS THE FIRST KIND TO POPULATE body_blocks. Every live interior before this took the flat
  // fallback, so this is the first time ArticleBody's blocks path renders in production.
  it("renders the BLOCKS path when bodyBlocks is present, and drops an unknown block type", () => {
    render(<NewsArticleView
      article={article({
        bodyBlocks: [
          { type: "para", text: "Block prose." },
          { type: "subhead", text: "The Long Middle" },
          { type: "list", items: ["one", "two"] },
          // A block type this build does not know about. ArticleBody's switch ends in
          // `default: return null`, so it is DROPPED rather than crashing the page.
          { type: "future-kind", text: "should vanish" } as never,
        ],
      })}
      more={[]} timelines={[]} now={now} />);
    expect(screen.getByText("Block prose.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "The Long Middle" })).toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.queryByText("should vanish")).toBeNull();
    // The flat body must NOT also render — blocks take precedence.
    expect(screen.queryByText("Flat fallback paragraph.")).toBeNull();
  });

  // PR-C2's schema admits a `quote` BLOCK and a standalone `pullQuote` INDEPENDENTLY, and nothing
  // in the prompt discourages using both. ArticleBody renders a `quote` block as a PullQuote, so
  // without the render-side guard a model that puts its best line in each place ships two
  // identical stacked blockquotes. This is the first PR where that can happen in production.
  it("renders exactly ONE pull quote when the blocks already carry a quote", () => {
    const { container } = render(<NewsArticleView
      article={article({
        bodyBlocks: [
          { type: "para", text: "Block prose." },
          { type: "quote", text: "He was here on Tuesday.", attribution: "a quartermaster" },
        ],
      })}
      more={[]} timelines={[]} now={now} />);
    // The base fixture's `pullQuote` carries the very same line — the realistic duplicate.
    expect(container.querySelectorAll("blockquote")).toHaveLength(1);
    expect(screen.getAllByText(/He was here on Tuesday/)).toHaveLength(1);
  });

  it("still renders the standalone pull quote when the blocks carry none", () => {
    const { container } = render(<NewsArticleView
      article={article({ bodyBlocks: [{ type: "para", text: "Block prose." }] })}
      more={[]} timelines={[]} now={now} />);
    expect(container.querySelectorAll("blockquote")).toHaveLength(1);
    expect(screen.getByText(/He was here on Tuesday/)).toBeInTheDocument();
  });
});

describe("NewsArticleView — the status line", () => {
  it("renders for a Standing Dead piece", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(screen.getByText(/AS OF PUBLICATION, 3 DAYS WITHOUT A SIGHTING/i)).toBeInTheDocument();
  });

  it("is absent for a Long Form piece", () => {
    render(<NewsArticleView
      article={article({ trigger: "long_form", subjectStatus: null, idleSeconds: null, spanSeconds: 27, subjectCount: 2 })}
      more={[]} timelines={[]} now={now} />);
    expect(screen.queryByText(/WITHOUT A SIGHTING/i)).toBeNull();
  });

  it("prints a retraction banner when the piece has been de-published", () => {
    render(<NewsArticleView
      article={article({ retracted: true, subjectStatus: { kind: "returned", seenAt: "2026-07-16T09:00:00Z" } })}
      more={[]} timelines={[]} now={now} />);
    expect(screen.getByText(/RETRACTED/i)).toBeInTheDocument();
    expect(screen.getByText(/SUBJECT WAS SEEN AGAIN ON 16 JUL 2026/i)).toBeInTheDocument();
  });

  it("suppresses the hero photo on a retracted piece — its bytes 404 behind the published-only media route", () => {
    render(<NewsArticleView
      article={article({ retracted: true, imageUrl: "/media/heroes/x.png", imageCaption: "GONE" })}
      more={[]} timelines={[]} now={now} />);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("NewsArticleView — the timeline embed", () => {
  it("renders ONE timeline for a Standing Dead piece, with the positions-withheld notice", () => {
    render(<NewsArticleView
      article={article()} more={[]}
      timelines={[{ gamertag: "GabeFox101", view: view(true) }]} now={now} />);
    expect(screen.getAllByText(/Washed ashore/)).toHaveLength(1);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
  });

  it("renders TWO timelines for a Long Form piece, each headed by its subject", () => {
    const timelines: NewsTimeline[] = [
      { gamertag: "CUPID18", view: view(false) },
      { gamertag: "GabeFox101", view: view(false) },
    ];
    render(<NewsArticleView
      article={article({ trigger: "long_form", subjectCount: 2, subjectStatus: null, idleSeconds: null, spanSeconds: 27 })}
      more={[]} timelines={timelines} now={now} />);
    expect(screen.getByRole("heading", { level: 2, name: /CUPID18/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /GabeFox101/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Washed ashore/)).toHaveLength(2);
  });

  it("degrades to the timelines that loaded when one subject's is unavailable", () => {
    render(<NewsArticleView
      article={article({ trigger: "long_form", subjectCount: 2, subjectStatus: null, idleSeconds: null, spanSeconds: 27 })}
      more={[]} timelines={[{ gamertag: "CUPID18", view: view(false) }]} now={now} />);
    expect(screen.getByRole("heading", { level: 2, name: /CUPID18/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Washed ashore/)).toHaveLength(1);
  });

  it("renders no timeline section at all when none loaded", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(screen.queryByText(/Washed ashore/)).toBeNull();
  });

  // I1: NEWS_TIMELINE_LIMIT's documented contract is that a theoretical third subject is still
  // named in the prose/dossier but only the first NEWS_TIMELINE_LIMIT timelines actually render.
  // No prior fixture supplies three, so `.slice(0, NEWS_TIMELINE_LIMIT)` had zero coverage.
  it("renders only NEWS_TIMELINE_LIMIT timelines when three are supplied", () => {
    const timelines: NewsTimeline[] = [
      { gamertag: "CUPID18", view: view(false) },
      { gamertag: "GabeFox101", view: view(false) },
      { gamertag: "ThirdSubject", view: view(false) },
    ];
    render(<NewsArticleView
      article={article({ trigger: "long_form", subjectCount: 3, subjectStatus: null, idleSeconds: null, spanSeconds: 27 })}
      more={[]} timelines={timelines} now={now} />);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 2, name: /CUPID18/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /GabeFox101/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /ThirdSubject/ })).toBeNull();
  });

  // I2: the side-by-side grid is the Long Form format's whole visual argument — two columns from
  // `lg` up, joined by a hairline rule, collapsing to a single stack on mobile and whenever there
  // is only one timeline to show. No prior test asserted the grid classes at all.
  it("applies the side-by-side grid classes for two timelines and omits them for one", () => {
    const twoTimelines: NewsTimeline[] = [
      { gamertag: "CUPID18", view: view(false) },
      { gamertag: "GabeFox101", view: view(false) },
    ];
    const { container: twoUp } = render(<NewsArticleView
      article={article({ trigger: "long_form", subjectCount: 2, subjectStatus: null, idleSeconds: null, spanSeconds: 27 })}
      more={[]} timelines={twoTimelines} now={now} />);
    const twoUpGrid = twoUp.querySelector(".mt-8");
    expect(twoUpGrid).not.toBeNull();
    expect(twoUpGrid).toHaveClass("lg:grid-cols-2");
    expect(twoUpGrid).toHaveClass("lg:divide-x");

    const { container: oneUp } = render(<NewsArticleView
      article={article({ trigger: "long_form", subjectCount: 2, subjectStatus: null, idleSeconds: null, spanSeconds: 27 })}
      more={[]} timelines={[{ gamertag: "CUPID18", view: view(false) }]} now={now} />);
    const oneUpGrid = oneUp.querySelector(".mt-8");
    expect(oneUpGrid).not.toBeNull();
    expect(oneUpGrid).not.toHaveClass("lg:grid-cols-2");
    expect(oneUpGrid).not.toHaveClass("lg:divide-x");
  });
});

// `MoreFromTheDesk` (Task 9) has `if (rows.length === 0) return null;` — every existing test in
// this suite renders with `more={[]}` and would stay green even if that guard were deleted, since
// none of them assert the section's absence. These two tests close that gap: one proves the guard
// suppresses the section on an empty related-rows array (the fixture Task 9 never exercised), and
// the other proves the check can actually detect the section when it IS present — an absence
// assertion is worthless unless the same check can also see a presence.
describe("NewsArticleView — the related rail", () => {
  it("renders no related rail when no rows are supplied", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(screen.queryByText("More From the Desk")).toBeNull();
  });

  it("renders the related rail when rows are supplied", () => {
    render(<NewsArticleView
      article={article()}
      more={[{
        slug: "long-form-two-fell-together-cupid18-7-5",
        trigger: "long_form", gamertag: "CUPID18", map: "sakhal", mapSlug: "sakhal",
        lifeNumber: 5, headline: "Two Fell Together", lede: "A shared ending.",
        tags: ["News"], subjectCount: 2, createdAt: "2026-07-10T00:00:00Z",
      }]}
      timelines={[]} now={now} />);
    expect(screen.getByText("More From the Desk")).toBeInTheDocument();
    expect(screen.getByText("Two Fell Together")).toBeInTheDocument();
  });
});

// ── THE §11 FOG RAIL, RENDERED HALF ──
// The source half (fixtures whose `positions` rows DO carry coordinates) is asserted in
// packages/read-models/test/news-articles.test.ts. This half asserts nothing coordinate-shaped
// survives into the DOM, in two cases: a REALISTIC article with every optional field populated
// (which documents the shipped shape but, having no coordinate to leak, cannot itself fail), and a
// deliberately POISONED one that hands the component real coordinates on both of the interior's
// data sources. The second is the load-bearing one — see its comment.
describe("NewsArticleView — the Fog Rule reaches the rendered page", () => {
  // The SAME eight keys as COORDINATE_KEYS in apps/newsdesk/test/news-facts.test.ts and in the
  // three files Task 1 repairs. One canonical set across the repo — no `z`, since `positions` has
  // no such column and a divergent list confuses the next person porting the helper.
  const COORDINATE_KEYS = ["x", "y", "posX", "posY", "coordX", "coordY", "lat", "lon"];

  function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
    if (value instanceof Date) return keys;
    if (Array.isArray(value)) {
      for (const item of value) collectKeys(item, keys);
    } else if (value !== null && typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        keys.add(key);
        collectKeys(val, keys);
      }
    }
    return keys;
  }

  it("renders no coordinate key and no coordinate-shaped number anywhere in the interior", () => {
    const a = article({
      imageUrl: "/media/heroes/x.png", imageCaption: "A ROOM, RECENTLY LEFT",
      bodyBlocks: [{ type: "para", text: "Block prose." }, { type: "list", items: ["one"] }],
    });
    const keys = collectKeys(a);
    for (const forbidden of COORDINATE_KEYS) expect(keys.has(forbidden)).toBe(false);

    const { container } = render(<NewsArticleView
      article={a} more={[]}
      timelines={[{ gamertag: "GabeFox101", view: view(true) }]} now={now} />);
    const text = container.textContent ?? "";
    // 812.4 is a real near-edge coordinate that /\d{4}\.\d/ misses, so match ANY 3-to-5 digit
    // decimal — the interior legitimately renders no decimal number at all.
    expect(text).not.toMatch(/\d{3,5}\.\d/);
    expect(text).toContain("Positions withheld");
  });

  // THE ASSERTION ABOVE, ON ITS OWN, CANNOT FAIL. Its fixture contains no coordinate at any depth
  // — it proves that itself with the key walk — so `not.toMatch` holds for any implementation short
  // of one that fabricates a decimal from nothing. That is precisely the vacuity Task 1 exists to
  // repair. This second case supplies coordinate-BEARING input instead: the component is handed
  // real coordinates on both of the interior's two data sources (the article DTO and a timeline
  // event) and must render neither. It fails the moment NewsArticleView renders a field it was
  // handed rather than one it was designed to render — which is the property §11 actually needs.
  it("renders neither coordinate when it is HANDED coordinates on both data sources", () => {
    // `as unknown as Partial<NewsArticle>`, NOT `as never`: spreading a `never` is TS2698
    // ("Spread types may only be created from object types") and would fail `typecheck` even
    // though vitest strips it. These casts are the point of the fixture — they smuggle a field
    // past the type system that the component was never designed to receive.
    const poisoned = article({
      imageUrl: "/media/heroes/x.png", imageCaption: "A ROOM, RECENTLY LEFT",
      ...({ x: 7423.51, y: 812.4 } as unknown as Partial<NewsArticle>),
    });
    const poisonedView: LifeTimelineView = {
      ...view(true),
      events: [
        { ...view(true).events[0]!, x: 7423.51, y: 812.4 } as unknown as LifeTimelineView["events"][number],
      ],
    };

    // Guard the guard: if these ever stop holding, the fixture has silently gone clean again and
    // the assertions below revert to proving nothing.
    expect(collectKeys(poisoned).has("x")).toBe(true);
    expect(collectKeys(poisonedView).has("y")).toBe(true);

    const { container } = render(<NewsArticleView
      article={poisoned} more={[]}
      timelines={[{ gamertag: "GabeFox101", view: poisonedView }]} now={now} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("7423.51");
    expect(text).not.toContain("812.4");   // the near-edge value /\d{4}\.\d/ would have missed
    expect(text).not.toMatch(/\d{3,5}\.\d/);
  });
});
