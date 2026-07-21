import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import RootLayout from "./layout";

// Pill re-homing (sub-project 4): the content column used to reserve a `pb-24` bottom gutter
// so the floating account pill (retired) never overlapped page content. With no fixed-bottom
// chrome left (the account trigger lives in the masthead now), that gutter must be gone —
// otherwise every page keeps paying for a control that no longer exists.
//
// RootLayout is a server component that renders <html>/<body> directly; mounting it through
// RTL nests those under jsdom's own document element, which prints a harmless
// "cannot be a child of" hydration warning (the same class of noise already accepted elsewhere
// in this suite, e.g. article-hero.test.tsx's next/image warnings) — it does not affect the
// assertions below. next/font/google requires the Next.js SWC transform, which vitest doesn't
// run, so "./fonts" is stubbed like every other heavy child.
vi.mock("@/components/header", () => ({ Masthead: () => <div data-testid="masthead" /> }));
vi.mock("@/components/footer", () => ({ Footer: () => <div data-testid="footer" /> }));
vi.mock("@/components/query-provider", () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="qp">{children}</div>,
}));
vi.mock("@/components/controls/rail", () => ({ ControlsRail: () => <div data-testid="rail" /> }));
vi.mock("./fonts", () => ({ display: { variable: "font-display-var" }, mono: { variable: "font-mono-var" } }));

describe("RootLayout", () => {
  test("the content column no longer reserves the pb-24 bottom gutter the retired floating pill needed", () => {
    render(RootLayout({ children: <div data-testid="child" /> }), {
      container: document.body,
      baseElement: document.body,
    });
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main!.className).not.toMatch(/\bpb-24\b/);
  });
});
