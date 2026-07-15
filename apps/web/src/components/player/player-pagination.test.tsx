import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PlayerPagination } from "./player-pagination";

describe("PlayerPagination", () => {
  it("returns nothing when there is a single page", () => {
    const { container } = render(<PlayerPagination slug="legend" page={1} total={8} pageSize={10} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("links to page 2 and bare page 1", () => {
    render(<PlayerPagination slug="legend" page={1} total={25} pageSize={10} />);
    expect(screen.getByRole("link", { name: /older/i })).toHaveAttribute("href", "/players/legend?page=2");
    // Newer on page 1 points at bare /players/legend
    expect(screen.getByRole("link", { name: /newer/i })).toHaveAttribute("href", "/players/legend");
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
  });
});
