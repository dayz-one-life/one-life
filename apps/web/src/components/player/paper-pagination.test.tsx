import { render, screen } from "@testing-library/react";
import { test, expect, describe } from "vitest";
import { PaperPagination } from "./paper-pagination";

describe("PaperPagination", () => {
  test("returns nothing when there is a single page", () => {
    const { container } = render(<PaperPagination slug="legend" page={1} total={8} pageSize={10} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("links change ap and preserve the current past-lives page", () => {
    render(<PaperPagination slug="legend" page={1} total={25} pageSize={10} otherPage={4} />);
    expect(screen.getByRole("link", { name: /older/i })).toHaveAttribute("href", "/players/legend?page=4&ap=2");
  });

  test("omits page from the link when otherPage is not given", () => {
    render(<PaperPagination slug="legend" page={1} total={25} pageSize={10} />);
    expect(screen.getByRole("link", { name: /older/i })).toHaveAttribute("href", "/players/legend?ap=2");
  });

  test("edges: first page has no Newer link, a real Older link", () => {
    render(<PaperPagination slug="yrjustbad" page={1} total={25} pageSize={10} />);
    expect(screen.queryByRole("link", { name: /Newer/ })).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  test("edges: last page has no Older link, a real Newer link", () => {
    render(<PaperPagination slug="yrjustbad" page={3} total={25} pageSize={10} />);
    expect(screen.queryByRole("link", { name: /Older/ })).not.toBeInTheDocument();
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
  });
});
