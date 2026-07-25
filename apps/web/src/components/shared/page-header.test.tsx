import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  test("renders the title as the page h1", () => {
    render(<PageHeader title="The Roster" />);
    expect(screen.getByRole("heading", { level: 1, name: "The Roster" })).toBeInTheDocument();
  });

  test("a resolved count renders the number and its noun", () => {
    render(<PageHeader title="Leaderboard" count={{ kind: "ready", value: 104, noun: "alive" }} />);
    expect(screen.getByText(/104 alive/)).toBeInTheDocument();
  });

  // The repo's most-repeated bug class: a resolved zero and an unresolved count rendering as the
  // same thing, so "we don't know" is presented as "there are none".
  test("a resolved ZERO is a real zero, not the loading render", () => {
    const { container } = render(
      <PageHeader title="Leaderboard" count={{ kind: "ready", value: 0, noun: "alive" }} />,
    );
    expect(screen.getByText(/0 alive/)).toBeInTheDocument();
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });

  test("loading renders a busy placeholder and NO number", () => {
    const { container } = render(<PageHeader title="Leaderboard" count={{ kind: "loading" }} />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByText(/\d/)).toBeNull();
  });

  test("failed says so out loud rather than rendering silently empty", () => {
    render(<PageHeader title="Leaderboard" count={{ kind: "failed" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
  });

  test("renders a control when given one", () => {
    render(<PageHeader title="Maps" control={<button type="button">Switch</button>} />);
    expect(screen.getByRole("button", { name: "Switch" })).toBeInTheDocument();
  });

  test("omits the count line entirely when no count is supplied", () => {
    const { container } = render(<PageHeader title="You" />);
    expect(container.querySelector("p")).toBeNull();
  });

  // Ordinary flow content: a z-index here would make it a fourth altitude (LAYER LEGEND).
  test("carries no z-index and is not sticky", () => {
    const { container } = render(<PageHeader title="You" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/\bz-\d+/);
    expect(root.className).not.toMatch(/\bsticky\b/);
  });
});
