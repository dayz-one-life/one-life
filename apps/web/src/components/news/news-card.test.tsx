import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NewsCard } from "./news-card";
import type { NewsCard as Card } from "@/lib/types";

const card: Card = {
  slug: "standing-dead-still-standing-somewhere-gabefox101-7-3",
  trigger: "standing_dead", gamertag: "GabeFox101", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Still Standing, Somewhere", lede: "Nobody has had word since Tuesday.",
  tags: ["News", "Chernarus", "The Standing Dead"], subjectCount: 1,
  createdAt: "2026-07-12T00:00:00Z",
};

const now = new Date("2026-07-14T00:00:00Z");

describe("NewsCard", () => {
  it("links the headline to the interior and shows the dateline, lede and desk", () => {
    render(<NewsCard card={card} now={now} />);
    expect(screen.getByRole("link", { name: "Still Standing, Somewhere" }))
      .toHaveAttribute("href", "/news/standing-dead-still-standing-somewhere-gabefox101-7-3");
    expect(screen.getByText("CHERNARUS BUREAU · 2 days ago")).toBeInTheDocument();
    expect(screen.getByText("Nobody has had word since Tuesday.")).toBeInTheDocument();
    expect(screen.getByText("The Standing Dead")).toBeInTheDocument();
  });

  it("links the primary gamertag to their player page", () => {
    render(<NewsCard card={card} now={now} />);
    expect(screen.getByRole("link", { name: "GabeFox101" })).toHaveAttribute("href", "/players/gabefox101");
  });

  it("names the co-subject count on a multi-subject Long Form piece", () => {
    render(<NewsCard card={{ ...card, trigger: "long_form", subjectCount: 2, headline: "Two Went Out" }} now={now} />);
    expect(screen.getByText("The Long Form")).toBeInTheDocument();
    expect(screen.getByText("2 subjects")).toBeInTheDocument();
  });

  it("says nothing about subject count when there is only one", () => {
    render(<NewsCard card={card} now={now} />);
    expect(screen.queryByText(/subjects/)).toBeNull();
  });
});
