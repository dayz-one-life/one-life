import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NewsPagination } from "./news-pagination";

describe("NewsPagination", () => {
  it("renders the showing line with the BIRTH argument order (page, total, pageSize)", () => {
    // 7 filed, 3 per page, page 2 → items 4–6 of 7. Called in the obituary order, the same three
    // numbers render "Showing 3–3 of 3 filed" — the pin lives here as well as in
    // news-format.test.ts, because the call SITE is where the swap actually happens.
    render(<NewsPagination page={2} total={7} pageSize={3} />);
    expect(screen.getByText("Showing 4–6 of 7 filed")).toBeInTheDocument();
  });
});
