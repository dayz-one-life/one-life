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
});
