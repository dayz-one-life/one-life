import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { SurvivorRow, SiteStats } from "@/lib/types";
import { Hero } from "./hero";
import { TopSurvivors } from "./top-survivors";
import { SignInCta } from "./signin-cta";

// CountUp is a client component; under jsdom its effect runs but matchMedia is missing — stub it
// once for this file (reduced motion → no animation in these tests).
vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

const row = (over: Partial<SurvivorRow>): SurvivorRow => ({
  gamertag: "YrJustBad", map: "sakhal", slug: "sakhal", timeAliveSeconds: 82440,
  killsThisLife: 2, longestKillMeters: 25, avatarHash: null, ...over,
});

const stats: SiteStats = { deaths: 1247, alive: 38 };

describe("Hero", () => {
  it("runs the manifesto screamer with a kicker and About link", () => {
    render(<Hero />);
    expect(screen.getByText("The record of record")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How it works →" })).toHaveAttribute("href", "/about");
  });

  it("with stats, the ledger IS the h1 and the brand line demotes to the kicker", () => {
    render(<Hero stats={stats} />);
    // The accessible name comes from the sr-only sentence — final numbers, one clean announcement.
    expect(
      screen.getByRole("heading", { level: 1, name: "Deaths to date: 1,247. Still standing: 38." }),
    ).toBeInTheDocument();
    expect(screen.getByText("One life. No respawns.")).toBeInTheDocument(); // the kicker now
    expect(screen.queryByText("The record of record")).not.toBeInTheDocument();
  });

  it("without stats, the evergreen hero renders — no zero, no placeholder, no banner", () => {
    render(<Hero stats={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.queryByText(/Deaths to date/)).not.toBeInTheDocument();
    // ⚠️ Live-data honesty: a missing number must never render as 0.
    expect(screen.queryByText(/\b0\b/)).not.toBeInTheDocument();
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
