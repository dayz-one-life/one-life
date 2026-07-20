import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NewsLead } from "./news-lead";
import type { NewsCard } from "@/lib/types";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...(props as object)} alt="" />,
}));

const NOW = new Date("2026-07-20T12:00:00Z");

const card = (over: Partial<NewsCard> = {}): NewsCard => ({
  slug: "long-form-three-seconds", trigger: "long_form", format: "editorial",
  editorialFormat: "long-form", gamertag: null, map: null, mapSlug: null, lifeNumber: null,
  headline: "Three Seconds Apart Coming In", lede: "The registry checked twice.",
  tags: ["The Long Form"], subjectCount: 2, createdAt: "2026-07-20T09:00:00Z",
  imageUrl: "/media/heroes/long-form-three-seconds.png?v=123", ...over,
});

describe("NewsLead", () => {
  it("renders nothing at all with no articles — the page falls back to the manifesto hero", () => {
    const { container } = render(<NewsLead lead={null} secondary={[]} now={NOW} />);
    expect(container.innerHTML).toBe("");
  });

  it("leads with the newest article: hero image, kicker, headline linking to the interior", () => {
    render(<NewsLead lead={card()} secondary={[]} now={NOW} />);
    const link = screen.getByRole("link", { name: /Three Seconds Apart Coming In/ });
    expect(link).toHaveAttribute("href", "/news/long-form-three-seconds");
    expect(document.querySelector("img")).toBeTruthy();
    expect(screen.getByText(/THE LONG FORM/)).toBeInTheDocument();
    expect(screen.getByText("The registry checked twice.")).toBeInTheDocument();
  });

  it("renders a lead without an image as text-only — no broken frame", () => {
    render(<NewsLead lead={card({ imageUrl: null })} secondary={[]} now={NOW} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: /Three Seconds Apart Coming In/ })).toBeInTheDocument();
  });

  it("renders the two secondary articles side by side below the lead", () => {
    render(<NewsLead
      lead={card()}
      secondary={[
        card({ slug: "ledger-books", headline: "The Ledger Opens Its Books", editorialFormat: "ledger", imageUrl: "/media/heroes/ledger-books.png?v=9" }),
        card({ slug: "almanac-census", headline: "The First Census of the Dead", editorialFormat: "almanac", imageUrl: null }),
      ]}
      now={NOW}
    />);
    expect(screen.getByRole("link", { name: /The Ledger Opens Its Books/ }))
      .toHaveAttribute("href", "/news/ledger-books");
    expect(screen.getByRole("link", { name: /The First Census of the Dead/ }))
      .toHaveAttribute("href", "/news/almanac-census");
  });

  it("uses the bureau dateline for a subjectful trigger card", () => {
    render(<NewsLead lead={card({ format: "standing_dead", editorialFormat: null, map: "chernarusplus", gamertag: "GabeFox101" })} secondary={[]} now={NOW} />);
    expect(screen.getByText(/CHERNARUS BUREAU/)).toBeInTheDocument();
  });
});
