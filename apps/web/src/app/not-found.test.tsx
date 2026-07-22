import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import NotFound from "./not-found";

// not-found.tsx renders against the ROOT layout, which no longer carries the site chrome.
// Without an explicit masthead and footer here, a 404 is a dead end with no navigation.
vi.mock("@/components/header", () => ({ Masthead: () => <div data-testid="masthead" /> }));
vi.mock("@/components/footer", () => ({ Footer: () => <div data-testid="footer" /> }));

describe("NotFound", () => {
  test("keeps site navigation, which the root layout no longer provides", () => {
    render(<NotFound />);
    expect(screen.getByTestId("masthead")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /not found/i })).toBeInTheDocument();
  });

  test("provides the #main-content target the root layout's skip link points at", () => {
    // This page renders against the ROOT layout, outside the (site) group that owns
    // #main-content — without this id the skip link lands nowhere.
    render(<NotFound />);
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main!.tagName).toBe("MAIN");
    expect(main!.getAttribute("tabindex")).toBe("-1");
  });
});
