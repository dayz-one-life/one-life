import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, test, vi } from "vitest";
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
  subjectStatus: { kind: "alive" },
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
    render(<BirthNoticeArticleView article={{ ...article, subjectStatus: { kind: "dead", diedAt: "2026-07-17T11:00:00Z" } }} more={[]} now={now} />);
    expect(screen.getByText(/Didn't last the day/)).toBeInTheDocument();
  });

  test("status line is live — reads dead even when the frozen endedAt still says alive (the bug this recompute fixes)", () => {
    render(<BirthNoticeArticleView article={{ ...article, endedAt: null, subjectStatus: { kind: "dead", diedAt: "2026-07-17T11:00:00Z" } }} more={[]} now={now} />);
    expect(screen.getByText(/Didn't last the day/)).toBeInTheDocument();
  });

  // A response from a deploy predating this field (stale cache/CDN) would omit `subjectStatus`
  // entirely. `dead` must fall back to "not dead" (the alive default) rather than throwing on
  // `.kind` of undefined.
  test("a response missing subjectStatus (stale cache predating the field) renders the alive default without throwing", () => {
    const { subjectStatus: _subjectStatus, ...rest } = article;
    const stale = rest as unknown as BirthNoticeArticle;
    expect(() => render(<BirthNoticeArticleView article={stale} more={[]} now={now} />)).not.toThrow();
    expect(screen.getByText(/Still drawing breath/)).toBeInTheDocument();
  });

  test("renders no hero image when imageUrl is absent", () => {
    render(<BirthNoticeArticleView article={article} more={[]} now={now} />);
    expect(document.querySelector("img")).toBeNull();
  });

  test("body wrapper carries the birth notice's mt-6 top margin", () => {
    render(<BirthNoticeArticleView article={article} more={[]} now={now} />);
    expect(screen.getByText("The tide does not care who it drops on the sand.").parentElement).toHaveClass("mt-6");
  });

  test("links the life number to that life's timeline", () => {
    render(
      <BirthNoticeArticleView
        article={{ ...article, gamertag: "Dead Eye Jim", mapSlug: "sakhal", lifeNumber: 4 }}
        more={[]}
        now={now}
      />,
    );
    expect(screen.getByRole("link", { name: /life 4/i })).toHaveAttribute("href", "/players/dead-eye-jim/sakhal/lives/4");
  });

  test("renders the life number as plain text when the server has no slug", () => {
    render(<BirthNoticeArticleView article={{ ...article, mapSlug: null, lifeNumber: 4 }} more={[]} now={now} />);
    expect(screen.queryByRole("link", { name: /life 4/i })).toBeNull();
    expect(screen.getByText(/life 4/i)).toBeInTheDocument();
  });
});

describe("birth notice prose linkification", () => {
  it("links the subject in the body", () => {
    render(
      <BirthNoticeArticleView
        article={{ ...article, gamertag: "Pyle", body: "Pyle drew breath on the coast.", bodyBlocks: null }}
        more={[]}
        now={now}
      />,
    );
    // The byline ALSO links the subject's gamertag (via GamertagLink), so a document-wide
    // getByRole query would be ambiguous and would pass even if the body itself were never
    // linkified. Scope the query to the body wrapper (identified by its "mt-6" class, the same
    // hook the "body wrapper carries the birth notice's mt-6 top margin" test above uses) to
    // prove the BODY specifically was linkified.
    const body = document.querySelector(".mt-6");
    expect(body).not.toBeNull();
    expect(within(body as HTMLElement).getByRole("link", { name: "Pyle" })).toHaveAttribute("href", "/players/pyle");
  });
});
