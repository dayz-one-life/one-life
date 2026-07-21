import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { linkifyGamertags, dedupeRoster } from "./linkify-gamertags";

const view = (text: string, roster: string[]) => render(<p>{linkifyGamertags(text, roster)}</p>);

describe("linkifyGamertags", () => {
  it("links a gamertag that appears in the prose", () => {
    view("Then Hartman went quiet.", ["Hartman"]);
    expect(screen.getByRole("link", { name: "Hartman" })).toHaveAttribute("href", "/players/hartman");
  });

  it("returns the text untouched when the roster is empty", () => {
    const { container } = view("Then Hartman went quiet.", []);
    expect(container.textContent).toBe("Then Hartman went quiet.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("matches case-insensitively but renders the prose's own casing", () => {
    view("they called him hartman.", ["Hartman"]);
    const link = screen.getByRole("link", { name: "hartman" });
    expect(link).toHaveAttribute("href", "/players/hartman");
  });

  it("never matches inside a longer word", () => {
    view("A hunter shot Hunter.", ["Hunter"]);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
  });

  it("does not match a gamertag glued to trailing word characters", () => {
    const { container } = view("Hartman2 is someone else.", ["Hartman"]);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("links every occurrence, not just the first", () => {
    view("Hartman fired. Hartman missed. Hartman ran.", ["Hartman"]);
    expect(screen.getAllByRole("link", { name: "Hartman" })).toHaveLength(3);
  });

  it("prefers the longest match so a short name cannot shadow a longer one", () => {
    view("Big Bear was there.", ["Bear", "Big Bear"]);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Big Bear");
    expect(links[0]).toHaveAttribute("href", "/players/big-bear");
  });

  it("treats regex metacharacters in a gamertag literally", () => {
    view("watch out for A.C (x) tonight", ["A.C (x)"]);
    expect(screen.getByRole("link", { name: "A.C (x)" })).toBeInTheDocument();
    const { container } = render(<p>{linkifyGamertags("AXC (x) is fine", ["A.C (x)"])}</p>);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("links a multi-word gamertag", () => {
    view("xSgt Hartman took the ridge.", ["xSgt Hartman"]);
    expect(screen.getByRole("link", { name: "xSgt Hartman" })).toHaveAttribute("href", "/players/xsgt-hartman");
  });

  it("preserves the surrounding prose exactly", () => {
    const { container } = view("Then Hartman went quiet.", ["Hartman"]);
    expect(container.textContent).toBe("Then Hartman went quiet.");
  });

  it("ignores null and empty roster entries", () => {
    const { container } = render(<p>{linkifyGamertags("nothing here", ["", "  "])}</p>);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});

describe("dedupeRoster", () => {
  it("trims, drops empties/non-strings, dedupes case-insensitively, and preserves input order", () => {
    expect(
      dedupeRoster(["Hartman", "  Bear  ", "hartman", "", null, undefined, "  ", "Bear", "Wolfe"]),
    ).toEqual(["Hartman", "Bear", "Wolfe"]);
  });
});
