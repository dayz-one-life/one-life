import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { BirthNoticeCard } from "./birth-notice-card";
import type { BirthNoticeCard as Card } from "@/lib/types";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...(props as object)} alt="" />,
}));

const now = new Date("2026-07-17T12:00:00Z");
const card: Card = {
  slug: "new-fool-ashore-3", gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Another Fool Washes Ashore", lede: "The tide brought us one more.",
  tags: ["Fresh Spawns", "Chernarus"], bornAt: "2026-07-17T10:00:00Z", minutesToQualify: 6, priorLives: 2,
};

describe("BirthNoticeCard", () => {
  test("headline links to the interior notice; gamertag to the dossier; shows dek + dateline + prior lives", () => {
    render(<BirthNoticeCard card={card} now={now} />);
    expect(screen.getByRole("link", { name: /Another Fool Washes Ashore/ })).toHaveAttribute("href", "/fresh-spawns/new-fool-ashore-3");
    expect(screen.getByRole("link", { name: "xX_Sn1per_Xx" })).toHaveAttribute("href", "/players/xx-sn1per-xx");
    expect(screen.getByText("The tide brought us one more.")).toBeInTheDocument();
    expect(screen.getByText(/CHERNARUS BUREAU/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // prior lives
  });
  test("first-lifer shows the First life badge instead of a prior-lives count", () => {
    render(<BirthNoticeCard card={{ ...card, priorLives: 0 }} now={now} />);
    expect(screen.getByText("First life")).toBeInTheDocument();
  });
  test("renders no thumbnail and no wrapper divs when imageUrl is absent", () => {
    render(<BirthNoticeCard card={card} now={now} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".flex.gap-4")).toBeNull();
    expect(document.querySelector("article")?.firstElementChild?.tagName).toBe("P");
  });
});
