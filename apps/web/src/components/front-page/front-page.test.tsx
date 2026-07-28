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
    expect(screen.getByText(/One life\. No respawns —/i)).toBeInTheDocument();
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
