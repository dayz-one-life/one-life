import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PullQuote } from "./pull-quote";

describe("PullQuote", () => {
  it("renders plain string text", () => {
    render(<PullQuote text="He never made the treeline." attribution="a voice on the coast" />);
    expect(screen.getByText(/never made the treeline/)).toBeInTheDocument();
  });

  it("renders rich nodes so a quote can contain a link", () => {
    render(<PullQuote text={<a href="/players/hartman">Hartman</a>} attribution="a bystander" />);
    expect(screen.getByRole("link", { name: "Hartman" })).toHaveAttribute("href", "/players/hartman");
  });

  // The typographic characters ARE the design — an editor that rewrites them to the ASCII
  // straight quote and hyphen changes every pull quote on the site, and nothing else notices.
  // This shipped once during PR-3 and was caught by eye, not by a test.
  it("wraps the quote in typographic quotation marks and uses an em dash before the attribution", () => {
    const { container } = render(<PullQuote text="He never made the treeline." attribution="a voice on the coast" />);
    expect(container.querySelector("p")?.textContent).toBe("“He never made the treeline.”");
    expect(container.querySelector("footer")?.textContent).toBe("— a voice on the coast");
  });
});
