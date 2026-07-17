import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BirthNoticesPagination } from "./birth-notices-pagination";

describe("BirthNoticesPagination", () => {
  test("range line, page links, current page not a link", () => {
    render(<BirthNoticesPagination page={2} total={56} pageSize={20} />);
    expect(screen.getByText("Showing 21–40 of 56 ashore")).toBeInTheDocument();
    expect(screen.getByText("2")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "/fresh-spawns");
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "/fresh-spawns?page=3");
  });
  test("renders nothing when empty", () => {
    const { container } = render(<BirthNoticesPagination page={1} total={0} pageSize={20} />);
    expect(container).toBeEmptyDOMElement();
  });
});
