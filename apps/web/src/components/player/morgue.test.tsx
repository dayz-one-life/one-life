import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Morgue } from "./morgue";
import type { ObituaryEntry } from "@/lib/types";

const NOW = new Date("2026-07-30T12:00:00Z");

const TWO: ObituaryEntry[] = [
  {
    slug: "manicdote-livonia-11",
    map: "enoch",
    mapSlug: "livonia",
    lifeNumber: 11,
    headline: "Eleven days of caution, undone in a treeline",
    lede: "He had walked the northern rail since the first frost and never once fired first.",
    deathAt: "2026-07-28T09:00:00Z",
    timeAliveSeconds: 964_800,
    kills: 6,
    longestKillMeters: 214,
    cause: "mauled",
  },
  {
    slug: "manicdote-chernarus-6",
    map: "chernarusplus",
    mapSlug: "chernarus",
    lifeNumber: 6,
    headline: "A trade at the coast, and one rifle too slow",
    lede: null,
    deathAt: "2026-07-22T09:00:00Z",
    timeAliveSeconds: 329_400,
    kills: 2,
    longestKillMeters: null,
    cause: "pvp",
  },
];

afterEach(cleanup);

describe("<Morgue />", () => {
  it("links each headline to its obituary and offers a timeline button", () => {
    render(<Morgue entries={TWO} total={2} viewer="owner" state="ready" playerSlug="manicdote" now={NOW} />);
    expect(screen.getByRole("link", { name: /undone in a treeline/i })).toHaveAttribute(
      "href",
      "/obituaries/manicdote-livonia-11",
    );
    expect(screen.getAllByRole("link", { name: /timeline/i })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /timeline/i })[0]).toHaveAttribute(
      "href",
      "/players/manicdote/livonia/lives/11",
    );
  });

  it("counts OBITUARIES, not lives", () => {
    render(<Morgue entries={TWO} total={2} viewer="owner" state="ready" playerSlug="manicdote" now={NOW} />);
    expect(screen.getByText(/obituaries filed/i)).toBeInTheDocument();
    expect(screen.queryByText(/lives filed/i)).not.toBeInTheDocument();
  });

  it("renders its own empty copy when nothing is filed — not a bare heading", () => {
    render(<Morgue entries={[]} total={0} viewer="owner" state="ready" playerSlug="manicdote" now={NOW} />);
    expect(screen.getByText(/no obituary has been filed for you yet/i)).toBeInTheDocument();
  });

  it("distinguishes loading and failed from empty", () => {
    const { rerender } = render(
      <Morgue entries={[]} total={0} viewer="owner" state="loading" playerSlug="m" now={NOW} />,
    );
    expect(screen.queryByText(/no obituary has been filed/i)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<Morgue entries={[]} total={0} viewer="owner" state="failed" playerSlug="m" now={NOW} />);
    expect(screen.queryByText(/no obituary has been filed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it("shows no count it cannot vouch for while the fetch is unresolved", () => {
    render(<Morgue entries={[]} total={0} viewer="owner" state="loading" playerSlug="m" now={NOW} />);
    expect(screen.queryByText(/obituaries filed/i)).not.toBeInTheDocument();
  });

  it("addresses the public viewer in the third person", () => {
    render(<Morgue entries={[]} total={0} viewer="public" state="ready" playerSlug="m" now={NOW} />);
    expect(screen.getByText(/this survivor/i)).toBeInTheDocument();
  });
});
