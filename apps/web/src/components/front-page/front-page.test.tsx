import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Hero } from "./hero";
import { SignInCta } from "./signin-cta";

// CountUp is a client component; under jsdom its effect runs but matchMedia is missing — stub it
// once for this file (reduced motion → no animation in these tests).
vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
// FitLine mounts under jsdom and observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

// The kicker's text is deliberately split across a red <span> and a plain text node (Task 2:
// the em-dash lives outside the brand span), so RTL's default getByText — which only matches a
// node's OWN direct text-node children, not its full recursive textContent — cannot find the
// combined phrase. Read the kicker <p>'s full textContent directly instead.
const kicker = (root: HTMLElement) => root.querySelector<HTMLElement>("p.tracking-\\[\\.28em\\]")?.textContent ?? "";

describe("Hero", () => {
  const stats = { deaths: 4213, alive: 38 };

  it("renders the two-line ledger with no trailing periods", () => {
    render(<Hero stats={stats} />);
    // Accessible name = sr-only sentence; one mid period, no trailing period.
    expect(
      screen.getByRole("heading", { level: 1, name: "Deaths to date: 4,213. Still standing: 38" }),
    ).toBeInTheDocument();
    // The still-standing line is its own (aria-hidden) visible line, not part of line 1.
    expect(screen.getByText(/Still standing:/i)).toBeInTheDocument();
    // Kicker carries the demoted brand line.
    expect(kicker(document.body)).toMatch(/One life\. No respawns —/i);
  });

  it("carries the primary CTA to /login", () => {
    render(<Hero stats={stats} />);
    expect(screen.getByRole("link", { name: "Claim your life →" })).toHaveAttribute("href", "/login");
  });

  it("without stats, renders the evergreen dark hero — no zero, no ledger, CTA intact", () => {
    render(<Hero stats={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns" })).toBeInTheDocument();
    expect(screen.queryByText(/Deaths to date/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b0\b/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Claim your life →" })).toHaveAttribute("href", "/login");
  });

  it("without stats, the kicker reverts to the evergreen line — no double-printed brand line", () => {
    const { container } = render(<Hero stats={null} />);
    expect(kicker(container)).toBe("The record of record");
    // The brand kicker ("One life. No respawns —") only ever prints with stats; without them it
    // must not appear a second time above the identical h1 text.
    expect(kicker(container)).not.toMatch(/One life\. No respawns —/i);
  });

  it("with stats, the brand kicker prints once with the em-dash outside the red span", () => {
    render(<Hero stats={stats} />);
    expect(kicker(document.body)).toMatch(/One life\. No respawns —/i);
    // The red/bold span carries the brand phrase alone; the dash is plain text beside it.
    const brand = screen.getByText("One life. No respawns");
    expect(brand.tagName).toBe("SPAN");
    expect(brand.className).toContain("text-red");
    expect(brand.textContent).not.toContain("—");
  });

  it("deck and CTA sit in one two-column row at md, button filling its column", () => {
    const { container } = render(<Hero stats={{ deaths: 4213, alive: 38 }} />);
    const row = container.querySelector("[data-testid='hero-cta-row']");
    expect(row).not.toBeNull();
    expect(row!.className).toMatch(/md:grid-cols-2/);
    const cta = screen.getByRole("link", { name: "Claim your life →" });
    expect(cta.className).toMatch(/(^|\s)h-full(\s|$)/);
    expect(cta.className).toMatch(/(^|\s)w-full(\s|$)/);
  });

  it("unverified audience: the CTA reads Link your gamertag and anchors to the ladder", () => {
    render(<Hero stats={{ deaths: 10, alive: 2 }} audience="unverified" />);
    expect(screen.getByRole("link", { name: "Link your gamertag →" })).toHaveAttribute("href", "#claim");
    expect(screen.queryByRole("link", { name: "Claim your life →" })).not.toBeInTheDocument();
  });

  it("the stats-branch ledger line carries a CSS fallback size class before any measurement (jsdom never measures)", () => {
    const { container } = render(<Hero stats={stats} />);
    // The FitLine clone carries [data-fitline-clone]; its sibling is the visible line div, which
    // must carry the fallback size class — the clone itself must NOT (it always measures at the
    // fixed BASE_PX, unaffected by the fallback).
    const clone = container.querySelector("[data-fitline-clone]");
    expect(clone).not.toBeNull();
    expect(clone!.className).not.toContain("text-[clamp");
    // The clone sits inside its overflow-clipping wrapper (see fit-line.tsx), so the visible
    // line is the WRAPPER's sibling.
    const line = clone!.parentElement!.nextElementSibling as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.className).toContain("text-[clamp(2.5rem,9vw,10rem)]");
  });
});

describe("SignInCta", () => {
  it("renders for signed-out visitors", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<SignInCta />);
    expect(screen.getByText("Get on the board.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in →" })).toHaveAttribute("href", "/login");
  });
  it("renders nothing for verified users", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    const { container } = render(<SignInCta />);
    expect(container).toBeEmptyDOMElement();
  });
});
