import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ObituaryCard } from "./obituary-card";
import type { ObituaryCard as Card } from "@/lib/types";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...(props as object)} alt="" />,
}));

const card: Card = {
  slug: "the-king-is-dead-9", gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 4, headline: "The King Is Dead. A Chicken Is Wanted.", lede: "He arrived with a flare.",
  tags: ["Obituaries", "Chernarus"], timeAliveSeconds: 3456000, kills: 212, longestKillMeters: 410,
  cause: "pvp", deathAt: "2026-07-10T22:16:00Z", imageUrl: null, imageCaption: null,
};

describe("ObituaryCard", () => {
  test("headline links to the interior article; gamertag to the dossier", () => {
    render(<ObituaryCard card={card} now={new Date("2026-07-12T00:00:00Z")} />);
    expect(screen.getByRole("link", { name: /The King Is Dead/ })).toHaveAttribute("href", "/obituaries/the-king-is-dead-9");
    expect(screen.getByRole("link", { name: "xX_Sn1per_Xx" })).toHaveAttribute("href", "/players/xx-sn1per-xx");
  });
  test("shows the dek, dateline, and a Rap Sheet strip (kills, cause)", () => {
    render(<ObituaryCard card={card} now={new Date("2026-07-12T00:00:00Z")} />);
    expect(screen.getByText("He arrived with a flare.")).toBeInTheDocument();
    expect(screen.getByText(/CHERNARUS BUREAU/)).toBeInTheDocument();
    expect(screen.getByText("212")).toBeInTheDocument();
  });
  test("renders no thumbnail and no wrapper divs when imageUrl is absent", () => {
    render(<ObituaryCard card={card} now={new Date("2026-07-12T00:00:00Z")} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".flex.gap-4")).toBeNull();
    expect(document.querySelector("article")?.firstElementChild?.tagName).toBe("P");
  });
});
