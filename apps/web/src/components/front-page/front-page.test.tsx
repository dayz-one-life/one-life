import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { SurvivorRow } from "@/lib/types";
import { Hero } from "./hero";
import { TopSurvivors } from "./top-survivors";
import { SignInCta } from "./signin-cta";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

const row = (over: Partial<SurvivorRow>): SurvivorRow => ({
  gamertag: "YrJustBad", map: "sakhal", slug: "sakhal", timeAliveSeconds: 82440,
  killsThisLife: 2, longestKillMeters: 25, avatarHash: null, ...over,
});

describe("Hero", () => {
  it("runs the manifesto screamer with a kicker and About link", () => {
    render(<Hero />);
    expect(screen.getByText("The record of record")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How it works →" })).toHaveAttribute("href", "/about");
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
