import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FriendsPagination, friendsShowingLine } from "./pagination";

describe("friendsShowingLine", () => {
  it("clamps to the true total on the last page", () => {
    expect(friendsShowingLine(2, 25, 30)).toBe("Showing 26–30 of 30 friends");
    expect(friendsShowingLine(1, 25, 30)).toBe("Showing 1–25 of 30 friends");
  });
});

describe("FriendsPagination", () => {
  it("renders nothing when everything fits on one page", () => {
    const { container } = render(<FriendsPagination page={1} total={10} pageSize={25} onPage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Prev on the first page and Next on the last page", () => {
    render(<FriendsPagination page={1} total={30} pageSize={25} onPage={() => {}} />);
    expect(screen.getByText(/prev/i).closest("button,span")?.tagName).toBe("SPAN");
    expect(screen.getByText(/next/i).closest("button,span")?.tagName).toBe("BUTTON");
  });

  it("calls onPage with the next page number", () => {
    const onPage = vi.fn();
    render(<FriendsPagination page={1} total={30} pageSize={25} onPage={onPage} />);
    screen.getByRole("button", { name: /next/i }).click();
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("shows the showing line", () => {
    render(<FriendsPagination page={1} total={30} pageSize={25} onPage={() => {}} />);
    expect(screen.getByText(/showing 1–25 of 30 friends/i)).toBeInTheDocument();
  });
});
