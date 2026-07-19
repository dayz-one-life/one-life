import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { BirthNoticeArticleView } from "./birth-notice-article";
import type { BirthNoticeArticle } from "@/lib/types";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...(props as object)} alt="" />,
}));

const now = new Date("2026-07-17T12:00:00Z");
const article: BirthNoticeArticle = {
  slug: "new-fool-ashore-3", gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Another Fool Washes Ashore", lede: "L",
  tags: ["Fresh Spawns", "Chernarus"], bornAt: "2026-07-17T10:00:00Z", minutesToQualify: 6, priorLives: 2,
  body: "The tide does not care who it drops on the sand.",
  pullQuote: { text: "It always begins with a flare.", attribution: "a bystander" }, endedAt: null,
  priors: { livesLived: 2, longestLifeSeconds: 7200, totalKills: 9, usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal" },
};

describe("BirthNoticeArticleView", () => {
  test("renders kicker, headline, byline, body, pull quote, priors, tags, gamertag link", () => {
    render(<BirthNoticeArticleView article={article} more={[]} now={now} />);
    expect(screen.getByRole("heading", { level: 1, name: /Another Fool Washes Ashore/ })).toBeInTheDocument();
    expect(screen.getByText(/Birth Notice ·/)).toBeInTheDocument();
    expect(screen.getByText("The tide does not care who it drops on the sand.")).toBeInTheDocument();
    expect(screen.getByText(/It always begins with a flare/)).toBeInTheDocument();
    expect(screen.getByText("Lives lived")).toBeInTheDocument(); // Priors box
    expect(screen.getByText("Chernarus")).toBeInTheDocument(); // a tag
    expect(screen.getByRole("link", { name: "xX_Sn1per_Xx" })).toHaveAttribute("href", "/players/xx-sn1per-xx");
  });
  test("status line reads 'Still drawing breath' while alive", () => {
    render(<BirthNoticeArticleView article={article} more={[]} now={now} />);
    expect(screen.getByText(/Still drawing breath/)).toBeInTheDocument();
  });
  test("status line flips to a past-tense note once the life has died", () => {
    render(<BirthNoticeArticleView article={{ ...article, endedAt: "2026-07-17T11:00:00Z" }} more={[]} now={now} />);
    expect(screen.getByText(/Didn't last the day/)).toBeInTheDocument();
  });

  test("renders no hero image when imageUrl is absent", () => {
    render(<BirthNoticeArticleView article={article} more={[]} now={now} />);
    expect(document.querySelector("img")).toBeNull();
  });

  test("body wrapper carries the birth notice's mt-6 top margin", () => {
    render(<BirthNoticeArticleView article={article} more={[]} now={now} />);
    expect(screen.getByText("The tide does not care who it drops on the sand.").parentElement).toHaveClass("mt-6");
  });
});
