import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { MoreFreshMeat } from "./more-fresh-meat";
import type { BirthNoticeCard } from "@/lib/types";

const row: BirthNoticeCard = {
  slug: "r-1", gamertag: "Boots", map: "sakhal", mapSlug: "sakhal", lifeNumber: 1,
  headline: "Ashore And Doomed", lede: "L", tags: [], bornAt: "2026-07-17T10:00:00Z", minutesToQualify: null, priorLives: 0,
};

describe("MoreFreshMeat", () => {
  test("renders related notice headlines linking to their interiors", () => {
    render(<MoreFreshMeat rows={[row]} />);
    expect(screen.getByRole("link", { name: /Ashore And Doomed/ })).toHaveAttribute("href", "/fresh-spawns/r-1");
  });
  test("renders nothing when there are no rows", () => {
    const { container } = render(<MoreFreshMeat rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
