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
  killsThisLife: 2, longestKillMeters: 25, character: null, ...over,
});

describe("Hero", () => {
  it("runs the manifesto screamer with a kicker and About link", () => {
    render(<Hero />);
    expect(screen.getByText("The paper of record")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "One life. Then the obituary." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How it works →" })).toHaveAttribute("href", "/about");
  });
});

describe("TopSurvivors", () => {
  it("ranks rows with gamertag links, map, and time alive", () => {
    render(<TopSurvivors rows={[row({}), row({ gamertag: "Khushie", map: "chernarusplus", timeAliveSeconds: 30300 })]} />);
    expect(screen.getByRole("link", { name: "YrJustBad" })).toHaveAttribute("href", "/players/yrjustbad");
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ALL →" })).toHaveAttribute("href", "/survivors");
  });
  it("shows the quiet-coast empty state", () => {
    render(<TopSurvivors rows={[]} />);
    expect(screen.getByText(/THE COAST IS QUIET/)).toBeInTheDocument();
  });
});

describe("SignInCta", () => {
  it("renders for signed-out visitors", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<SignInCta />);
    expect(screen.getByText("Get in the paper.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in →" })).toHaveAttribute("href", "/login");
  });
  it("renders nothing for verified users", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    const { container } = render(<SignInCta />);
    expect(container).toBeEmptyDOMElement();
  });
});
