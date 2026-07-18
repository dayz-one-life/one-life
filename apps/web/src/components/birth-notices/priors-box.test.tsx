import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PriorsBox } from "./priors-box";
import type { BirthNoticeArticle } from "@/lib/types";

const returning: BirthNoticeArticle = {
  slug: "s", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  headline: "H", lede: "L", tags: [], bornAt: "2026-07-10T00:00:00Z", minutesToQualify: 6, priorLives: 2,
  imageUrl: null, imageCaption: null,
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
});
