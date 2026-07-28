import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ObituariesPagination } from "./obituaries-pagination";

describe("ObituariesPagination", () => {
  test("range line, page links, current page not a link", () => {
    render(<ObituariesPagination page={2} total={56} pageSize={20} />);
    expect(screen.getByText("Showing 21–40 of 56 filed")).toBeInTheDocument();
    expect(screen.getByText("2")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "/obituaries");
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "/obituaries?page=3");
  });
  test("renders nothing when empty", () => {
    const { container } = render(<ObituariesPagination page={1} total={0} pageSize={20} />);
    expect(container).toBeEmptyDOMElement();
  });
});
