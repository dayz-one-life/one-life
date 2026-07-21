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
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
  });

  it("edges: first page has no Newer link, a real Older link", () => {
    render(<PlayerPagination slug="yrjustbad" page={1} total={25} pageSize={10} />);
    expect(screen.queryByRole("link", { name: /Newer/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Older/ })).toHaveAttribute("href", "/players/yrjustbad?page=2");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("edges: last page has no Older link, a real Newer link", () => {
    render(<PlayerPagination slug="yrjustbad" page={3} total={25} pageSize={10} />);
    expect(screen.queryByRole("link", { name: /Older/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Newer/ })).toHaveAttribute("href", "/players/yrjustbad?page=2");
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
  });

  it("hidden with a single page", () => {
    const { container } = render(<PlayerPagination slug="x" page={1} total={5} pageSize={10} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("preserves the current In The Paper page (ap) when changing page", () => {
    render(<PlayerPagination slug="legend" page={1} total={25} pageSize={10} ap={2} />);
    expect(screen.getByRole("link", { name: /older/i })).toHaveAttribute("href", "/players/legend?page=2&ap=2");
  });
});
