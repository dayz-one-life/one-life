import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { EditorialArticleView } from "./editorial-article";
import type { NewsArticle } from "@/lib/types";

const NOW = new Date("2026-07-20T12:00:00Z");

const almanac = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  slug: "almanac-week-29", trigger: "long_form", format: "editorial", editorialFormat: "almanac",
  status: "published", gamertag: null, map: null, mapSlug: null, lifeNumber: null,
  headline: "The Coldest Map Keeps Its People Longest",
  lede: "The registry has finished counting.",
  body: "Forty-five souls against seventy.", bodyBlocks: null, pullQuote: null,
  imageUrl: null, imageCaption: null, retracted: false, timeAliveSeconds: 0, kills: 0,
  idleSeconds: null, spanSeconds: null, subjects: [], subjectStatus: null,
  tags: ["The Almanac"], subjectCount: 0, createdAt: "2026-07-20T09:00:00Z", ...over,
});

describe("EditorialArticleView", () => {
  it("kicks off with the editorial format, not a trigger label", () => {
    render(<EditorialArticleView article={almanac()} more={[]} now={NOW} />);
    // getAllByText: the kicker and the "The Almanac" tag chip both match — both are wanted.
    expect(screen.getAllByText(/THE ALMANAC/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/standing dead|long form/i)).toBeNull();
  });

  // The shipped byline renders <GamertagLink gamertag={article.gamertag}> unconditionally. An
  // institutional piece has no subject, so that link would be an empty link to /players/.
  it("bylines to the desk alone when there is no subject", () => {
    render(<EditorialArticleView article={almanac()} more={[]} now={NOW} />);
    expect(screen.getByText(/Filed by The Desk/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /players/i })).toBeNull();
  });

  it("renders the prose and shows no dossier, status line, or timeline", () => {
    render(<EditorialArticleView article={almanac()} more={[]} now={NOW} />);
    expect(screen.getByText(/Forty-five souls/)).toBeInTheDocument();
    expect(screen.queryByText(/the record so far/i)).toBeNull();
    expect(screen.queryByText(/without a sighting/i)).toBeNull();
  });

  // A draft must never be mistaken for a live page in a screenshot.
  it("banners a draft", () => {
    render(<EditorialArticleView article={almanac({ status: "draft" })} more={[]} now={NOW} />);
    expect(screen.getByText(/draft/i)).toBeInTheDocument();
  });
});
