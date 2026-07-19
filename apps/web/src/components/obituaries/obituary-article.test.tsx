import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ObituaryArticleView } from "./obituary-article";
import type { ObituaryArticle } from "@/lib/types";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...(props as object)} alt="" />,
}));

const article: ObituaryArticle = {
  slug: "the-king-is-dead-9", gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 4, headline: "The King Is Dead", lede: "He arrived with a flare.",
  tags: ["Obituaries", "Chernarus"], timeAliveSeconds: 3456000, kills: 212, longestKillMeters: 410,
  cause: "pvp", deathAt: "2026-07-10T22:16:00Z", body: "He left 212 kills behind.",
  pullQuote: { text: "You do not get a second life.", attribution: "a rival" }, sessions: 30,
  killerGamertag: "Chicken", weapon: "Reload", verdict: null,
};

describe("ObituaryArticleView", () => {
  test("renders headline, byline, body, pull quote, Rap Sheet, tags, gamertag link", () => {
    render(<ObituaryArticleView article={article} more={[]} finalReload={null} now={new Date("2026-07-12T00:00:00Z")} />);
    expect(screen.getByRole("heading", { level: 1, name: /The King Is Dead/ })).toBeInTheDocument();
    expect(screen.getByText(/CHERNARUS BUREAU/)).toBeInTheDocument();
    expect(screen.getByText("He left 212 kills behind.")).toBeInTheDocument();
    expect(screen.getByText(/You do not get a second life/)).toBeInTheDocument();
    expect(screen.getByText("212")).toBeInTheDocument(); // Rap Sheet kills
    expect(screen.getByText("Chernarus")).toBeInTheDocument(); // a tag
    expect(screen.getByRole("link", { name: "xX_Sn1per_Xx" })).toHaveAttribute("href", "/players/xx-sn1per-xx");
  });

  test("renders no hero image when imageUrl is absent", () => {
    render(<ObituaryArticleView article={article} more={[]} finalReload={null} now={new Date("2026-07-12T00:00:00Z")} />);
    expect(document.querySelector("img")).toBeNull();
  });

  test("body wrapper carries the obituary's mt-5 top margin", () => {
    render(<ObituaryArticleView article={article} more={[]} finalReload={null} now={new Date("2026-07-12T00:00:00Z")} />);
    expect(screen.getByText("He left 212 kills behind.").parentElement).toHaveClass("mt-5");
  });
});
