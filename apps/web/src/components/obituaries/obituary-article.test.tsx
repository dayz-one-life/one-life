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

  test("links the life number to that life's timeline", () => {
    render(
      <ObituaryArticleView
        article={{ ...article, gamertag: "Dead Eye Jim", mapSlug: "sakhal", lifeNumber: 4 }}
        more={[]}
        finalReload={null}
        now={new Date("2026-07-12T00:00:00Z")}
      />,
    );
    expect(screen.getByRole("link", { name: /life 4/i })).toHaveAttribute("href", "/players/dead-eye-jim/sakhal/lives/4");
  });

  test("renders the life number as plain text when the server has no slug", () => {
    render(
      <ObituaryArticleView
        article={{ ...article, mapSlug: null, lifeNumber: 4 }}
        more={[]}
        finalReload={null}
        now={new Date("2026-07-12T00:00:00Z")}
      />,
    );
    expect(screen.queryByRole("link", { name: /life 4/i })).toBeNull();
    expect(screen.getByText(/life 4/i)).toBeInTheDocument();
  });
});

describe("obituary prose linkification", () => {
  test("links the subject in the lede and the killer in the body", () => {
    render(
      <ObituaryArticleView
        article={{
          ...article,
          gamertag: "Hartman",
          killerGamertag: "Pyle",
          lede: "Hartman is dead.",
          body: "Pyle was waiting on the ridge.",
          bodyBlocks: null,
        }}
        more={[]}
        finalReload={null}
        now={new Date("2026-07-12T00:00:00Z")}
      />,
    );
    // "Hartman" is also linked in the byline (article.gamertag), so more than one match is expected —
    // assert every link named "Hartman" (byline + lede) points at the same dossier.
    const hartmanLinks = screen.getAllByRole("link", { name: "Hartman" });
    expect(hartmanLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of hartmanLinks) {
      expect(link).toHaveAttribute("href", "/players/hartman");
    }
    expect(screen.getByRole("link", { name: "Pyle" })).toHaveAttribute("href", "/players/pyle");
  });

  test("does not link the headline", () => {
    const { container } = render(
      <ObituaryArticleView
        article={{ ...article, gamertag: "Hartman", killerGamertag: null, headline: "Hartman Falls", lede: "", body: "", bodyBlocks: null }}
        more={[]}
        finalReload={null}
        now={new Date("2026-07-12T00:00:00Z")}
      />,
    );
    expect(container.querySelector("h1 a")).toBeNull();
  });
});
