import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NewsStatusLine } from "./news-status-line";

describe("NewsStatusLine", () => {
  it("still idle — reports what the paper knew when it printed", () => {
    render(<NewsStatusLine status={{ kind: "idle", idleDaysAtPublication: 3 }} />);
    expect(screen.getByText(/AS OF PUBLICATION, 3 DAYS WITHOUT A SIGHTING/i)).toBeInTheDocument();
  });

  it("singularises one day", () => {
    render(<NewsStatusLine status={{ kind: "idle", idleDaysAtPublication: 1 }} />);
    expect(screen.getByText(/1 DAY WITHOUT A SIGHTING/i)).toBeInTheDocument();
  });

  it("returned — prints the correction with a UTC date", () => {
    render(<NewsStatusLine status={{ kind: "returned", seenAt: "2026-07-16T09:00:00Z" }} />);
    expect(screen.getByText(/UPDATE: SUBJECT WAS SEEN AGAIN ON 16 JUL 2026/i)).toBeInTheDocument();
  });

  it("died since — links to the obituary when one exists", () => {
    render(<NewsStatusLine status={{ kind: "died", diedAt: "2026-07-17T09:00:00Z", obituarySlug: "the-end-9" }} />);
    expect(screen.getByText(/UPDATE: SUBJECT HAS SINCE DIED, 17 JUL 2026/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /READ THE OBITUARY/i })).toHaveAttribute("href", "/obituaries/the-end-9");
  });

  it("died since — states the death without a link when the morgue has not filed yet", () => {
    render(<NewsStatusLine status={{ kind: "died", diedAt: "2026-07-17T09:00:00Z", obituarySlug: null }} />);
    expect(screen.getByText(/UPDATE: SUBJECT HAS SINCE DIED, 17 JUL 2026/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
