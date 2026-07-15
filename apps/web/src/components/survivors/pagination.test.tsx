import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Pagination } from "./pagination";

describe("Pagination", () => {
  test("hides Prev on page 1, shows Next when more pages", () => {
    render(<Pagination slug={null} sort="kills" page={1} total={60} pageSize={25} />);
    expect(screen.queryByRole("link", { name: /prev/i })).toBeNull();
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute("href", "/survivors?page=2");
  });

  test("shows Prev and hides Next on the last page", () => {
    render(<Pagination slug="chernarus" sort="time" page={3} total={60} pageSize={25} />);
    expect(screen.getByRole("link", { name: /prev/i })).toHaveAttribute(
      "href",
      "/survivors/chernarus?sort=time&page=2"
    );
    expect(screen.queryByRole("link", { name: /next/i })).toBeNull();
  });

  test("renders windowed page number links", () => {
    render(<Pagination slug={null} sort="kills" page={2} total={60} pageSize={25} />);
    const page1 = screen.getByRole("link", { name: "1" });
    expect(page1).toHaveAttribute("href", "/survivors");
    const page3 = screen.getByRole("link", { name: "3" });
    expect(page3).toHaveAttribute("href", "/survivors?page=3");
    const current = screen.getByRole("link", { name: "2" });
    expect(current).toHaveAttribute("aria-current", "page");
  });
});
