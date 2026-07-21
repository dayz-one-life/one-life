import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PriorsBox } from "./priors-box";
import type { BirthNoticeArticle } from "@/lib/types";

const returning: BirthNoticeArticle = {
  slug: "s", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  headline: "H", lede: "L", tags: [], bornAt: "2026-07-10T00:00:00Z", minutesToQualify: 6, priorLives: 2,
  body: "B", pullQuote: null, endedAt: null,
  priors: { livesLived: 2, longestLifeSeconds: 7200, totalKills: 9, usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal" },
};

describe("PriorsBox", () => {
  test("returning player shows the deterministic prior rows + arrival note", () => {
    render(<PriorsBox article={returning} />);
    expect(screen.getByText("Lives lived")).toBeInTheDocument();
    expect(screen.getByText("Usual end")).toBeInTheDocument();
    expect(screen.getByText(/Washed ashore/)).toBeInTheDocument();
    expect(screen.getByText(/qualified in 6 min/)).toBeInTheDocument();
  });
  test("first-lifer shows the stranger line", () => {
    const first = { ...returning, priorLives: 0, priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null } };
    render(<PriorsBox article={first} />);
    expect(screen.getByText("No priors. A stranger to these shores.")).toBeInTheDocument();
  });

  test("each group renders <dt> before <dd> in DOM order, with flex-col-reverse preserving the value-over-label visual", () => {
    const { container } = render(<PriorsBox article={returning} />);
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
