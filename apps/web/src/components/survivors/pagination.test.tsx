import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Pagination } from "./pagination";

describe("Pagination", () => {
  test("shows the range line and page boxes; current page is not a link", () => {
    render(<Pagination slug={null} sort="time" page={2} total={56} pageSize={25} />);
    expect(screen.getByText("Showing 26–50 of 56 still breathing")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "2" })).not.toBeInTheDocument();
    expect(screen.getByText("2")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "/survivors");
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "/survivors?page=3");
  });

  test("prev/next are links mid-range", () => {
    render(<Pagination slug="sakhal" sort="kills" page={2} total={56} pageSize={25} />);
    expect(screen.getByRole("link", { name: /Prev/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/ })).toBeInTheDocument();
  });

  test("disabled edges are non-focusable spans, not links", () => {
    render(<Pagination slug={null} sort="time" page={1} total={30} pageSize={25} />);
    expect(screen.queryByRole("link", { name: /Prev/ })).not.toBeInTheDocument();
  });

  test("renders nothing when the board is empty", () => {
    const { container } = render(<Pagination slug={null} sort="time" page={1} total={0} pageSize={25} />);
    expect(container).toBeEmptyDOMElement();
  });
});
