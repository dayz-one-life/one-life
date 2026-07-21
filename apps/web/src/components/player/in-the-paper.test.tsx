import { render, screen } from "@testing-library/react";
import { test, expect, describe } from "vitest";
import { InThePaper, articleHref } from "./in-the-paper";

test("renders a row per article, linking to the interior", () => {
  render(
    <InThePaper
      slug="dead-eye-jim"
      rows={[{ kind: "obituary", slug: "last-light", headline: "Last Light On The Ridge", createdAt: "2026-07-12T00:00:00Z", role: "subject", mapSlug: "sakhal" }]}
      total={1}
      page={1}
      pageSize={10}
      failed={false}
    />,
  );
  expect(screen.getByRole("link", { name: /last light on the ridge/i })).toHaveAttribute("href", "/obituaries/last-light");
});

test("tags the role so a killer credit is not mistaken for their own obituary", () => {
  render(
    <InThePaper
      slug="x"
      rows={[{ kind: "obituary", slug: "s", headline: "H", createdAt: "2026-07-12T00:00:00Z", role: "killer", mapSlug: null }]}
      total={1}
      page={1}
      pageSize={10}
      failed={false}
    />,
  );
  expect(screen.getByText(/killer/i)).toBeInTheDocument();
});

test("renders nothing at all when the player has no articles", () => {
  const { container } = render(<InThePaper slug="x" rows={[]} total={0} page={1} pageSize={10} failed={false} />);
  expect(container).toBeEmptyDOMElement();
});

test("a failed fetch is reported, never rendered as an empty section", () => {
  // Loading/error must not be presented as an authoritative zero — a player whose articles
  // failed to load must not be told the paper never wrote about them.
  render(<InThePaper slug="x" rows={[]} total={0} page={1} pageSize={10} failed />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByText(/never/i)).toBeNull();
});

describe("articleHref", () => {
  test("obituary routes to /obituaries/{slug}", () => {
    expect(articleHref("obituary", "last-light")).toBe("/obituaries/last-light");
  });

  test("birth_notice routes to /fresh-spawns/{slug}", () => {
    expect(articleHref("birth_notice", "new-arrival")).toBe("/fresh-spawns/new-arrival");
  });

  test("news routes to /news/{slug}", () => {
    expect(articleHref("news", "a-story")).toBe("/news/a-story");
  });

  test("an unknown kind returns null rather than a broken href", () => {
    expect(articleHref("mystery", "whatever")).toBeNull();
  });

  test("an unknown kind renders the headline as plain text, not a link", () => {
    render(
      <InThePaper
        slug="x"
        rows={[{ kind: "mystery", slug: "s", headline: "Unroutable Headline", createdAt: "2026-07-12T00:00:00Z", role: "subject", mapSlug: null }]}
        total={1}
        page={1}
        pageSize={10}
        failed={false}
      />,
    );
    expect(screen.getByText("Unroutable Headline")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /unroutable headline/i })).toBeNull();
  });
});
