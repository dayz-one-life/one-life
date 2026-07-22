import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import SiteLayout from "./layout";

// Pill re-homing (sub-project 4): the content column used to reserve a `pb-24` bottom gutter
// so the floating account pill (retired) never overlapped page content. With no fixed-bottom
// chrome left (the account trigger lives in the masthead now), that gutter must be gone —
// otherwise every page keeps paying for a control that no longer exists.
vi.mock("@/components/header", () => ({ Masthead: () => <div data-testid="masthead" /> }));
vi.mock("@/components/footer", () => ({ Footer: () => <div data-testid="footer" /> }));
vi.mock("@/components/controls/rail", () => ({ ControlsRail: () => <div data-testid="rail" /> }));

describe("SiteLayout", () => {
  test("the content column no longer reserves the pb-24 bottom gutter the retired floating pill needed", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main!.className).not.toMatch(/\bpb-24\b/);
  });

  test("renders the masthead, rail and footer that /maps deliberately opts out of", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(screen.getByTestId("masthead")).toBeInTheDocument();
    expect(screen.getByTestId("rail")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
  });
});
