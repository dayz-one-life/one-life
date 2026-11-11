import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { RapSheet } from "./rap-sheet";
import type { ObituaryArticle } from "@/lib/types";

const article: ObituaryArticle = {
  slug: "the-king-is-dead-9", gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 4, headline: "The King Is Dead", lede: "He arrived with a flare.",
  tags: ["Obituaries", "Chernarus"], timeAliveSeconds: 3456000, kills: 212, longestKillMeters: 410,
  cause: "pvp", deathAt: "2026-07-10T22:16:00Z", body: "He left 212 kills behind.",
  pullQuote: { text: "You do not get a second life.", attribution: "a rival" }, sessions: 30,
  killerGamertag: "Chicken", weapon: "Reload", verdict: null, death: null,
};

describe("RapSheet heading", () => {
  test("title is an h2 (matches the article's sibling h2 sections)", () => {
    render(<RapSheet article={article} />);
    expect(screen.getByRole("heading", { level: 2, name: /The Rap Sheet/i })).toBeInTheDocument();
  });

  test("the section is labelled by the heading", () => {
    render(<RapSheet article={article} />);
    // A <section> with an accessible name exposes an implicit "region" role.
    expect(screen.getByRole("region", { name: /The Rap Sheet/i })).toBeInTheDocument();
  });
});

describe("RapSheet dl reading order", () => {
  test("each group renders <dt> before <dd> in DOM order, with flex-col-reverse preserving the value-over-label visual", () => {
    const { container } = render(<RapSheet article={article} />);
    const dl = container.querySelector("dl");
    expect(dl).not.toBeNull();
    const groups = Array.from(dl!.children) as HTMLElement[];
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const children = Array.from(group.children);
      expect(children).toHaveLength(2);
      expect(children[0]!.tagName).toBe("DT");
      expect(children[1]!.tagName).toBe("DD");
      expect(group.className).toContain("flex-col-reverse");
    }
  });
});

describe("RapSheet cause", () => {
  test("prints the death's label and its caption under the sheet", () => {
    render(<RapSheet article={{ ...article, cause: "died", death: {
      status: "final", key: "starvation_and_thirst", tag: "Hunger and Thirst", certainty: "inferred", label: "Likely starvation and thirst",
      detail: null, sentence: "Likely starved and dehydrated.", caption: "Best reading of the log. The server recorded no cause.",
      killerGamertag: null, driverGamertag: null, credit: null, trap: false, selfStated: false, cause: "starvation", confidence: "low", conditions: [],
    } }} />);
    expect(screen.getByText("Likely starvation and thirst")).toBeInTheDocument();
    expect(screen.getByText("Best reading of the log. The server recorded no cause.")).toBeInTheDocument();
  });

  test("an article with no death keeps the legacy wording and no caption", () => {
    render(<RapSheet article={{ ...article, cause: "pvp" }} />);
    expect(screen.getByText("Killed")).toBeInTheDocument();
    expect(screen.queryByText(/Worked out|Best reading/)).not.toBeInTheDocument();
  });
});
