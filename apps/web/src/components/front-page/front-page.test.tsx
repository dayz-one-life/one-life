import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { SurvivorRow } from "@/lib/types";
import { Hero } from "./hero";
import { TopSurvivors } from "./top-survivors";
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

const row = (over: Partial<SurvivorRow>): SurvivorRow => ({
  gamertag: "YrJustBad", map: "sakhal", slug: "sakhal", timeAliveSeconds: 82440,
  killsThisLife: 2, longestKillMeters: 25, avatarHash: null, ...over,
});

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

describe("TopSurvivors", () => {
  it("ranks rows with gamertag links and time alive", () => {
    render(<TopSurvivors slug="sakhal" map="sakhal" rows={[row({}), row({ gamertag: "Khushie", timeAliveSeconds: 30300 })]} />);
    expect(screen.getByRole("link", { name: "YrJustBad" })).toHaveAttribute("href", "/players/yrjustbad");
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // ⚠️ Links to THIS map's board, never a bare /survivors (a per-viewer redirect).
    expect(screen.getByRole("link", { name: "ALL →" })).toHaveAttribute("href", "/survivors/sakhal");
  });
  it("names the map it is scoped to, so the list is not silently partial", () => {
    render(<TopSurvivors slug="livonia" map="enoch" rows={[row({})]} />);
    // `enoch` is labelled Livonia — the heading uses the label, never the mission codename.
    expect(screen.getByText(/Still breathing on Livonia/i)).toBeInTheDocument();
  });
  it("shows the quiet-coast empty state", () => {
    render(<TopSurvivors slug="sakhal" map="sakhal" rows={[]} />);
    expect(screen.getByText(/THE COAST IS QUIET/)).toBeInTheDocument();
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
