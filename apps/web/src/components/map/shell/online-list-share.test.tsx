import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OnlinePlayerDto } from "@/lib/types";
import { OnlineList } from "./online-list";

const p = (over: Partial<OnlinePlayerDto>): OnlinePlayerDto => ({
  gamertag: "Boots", friend: false, sharing: false, sharedWithThem: false, self: false, ...over,
});

const handlers = () => ({ onShare: vi.fn(), onStopSharing: vi.fn() });

describe("OnlineList grant controls", () => {
  it("offers Share to someone the viewer is not sharing with", () => {
    const h = handlers();
    render(<OnlineList players={[p({})]} {...h} />);
    screen.getByRole("button", { name: "Share" }).click();
    expect(h.onShare).toHaveBeenCalledWith("Boots");
  });

  it("offers Stop to someone the viewer IS sharing with", () => {
    const h = handlers();
    render(<OnlineList players={[p({ sharedWithThem: true })]} {...h} />);
    screen.getByRole("button", { name: /stop/i }).click();
    expect(h.onStopSharing).toHaveBeenCalledWith("Boots");
  });

  // ⚠️ THE TWO DIRECTIONS ARE SEPARATE AND MUST STAY SO. `sharing` is what THEY have given the
  // viewer; `sharedWithThem` is what the viewer has given them. Conflating them would let
  // someone believe that seeing a dot means being seen — in a game where being seen gets you
  // killed.
  it("a player sharing WITH the viewer still shows Share, not Stop", () => {
    const h = handlers();
    render(<OnlineList players={[p({ sharing: true, sharedWithThem: false })]} {...h} />);
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByText(/on the map/i)).toBeInTheDocument();
  });

  it("renders both directions independently when they disagree", () => {
    const h = handlers();
    render(<OnlineList players={[p({ sharing: false, sharedWithThem: true })]} {...h} />);
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    expect(screen.queryByText(/on the map/i)).toBeNull();
  });

  it("never offers to share with yourself", () => {
    const h = handlers();
    render(<OnlineList players={[p({ self: true })]} {...h} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  // A viewer who cannot grant (offline, so no session to anchor a grant to) gets no controls
  // rather than buttons that 409.
  it("renders no controls when no handlers are supplied", () => {
    render(<OnlineList players={[p({}), p({ gamertag: "Other" })]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("disables only the row whose grant is in flight", () => {
    const h = handlers();
    render(<OnlineList players={[p({}), p({ gamertag: "Other" })]} pendingFor="Boots" {...h} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.filter((b) => b.hasAttribute("disabled"))).toHaveLength(1);
  });

  it("is written in dark-surface tokens", () => {
    // RTL asserts the DOM, not contrast: ink-on-dark renders present, functional and invisible.
    const h = handlers();
    render(<OnlineList players={[p({})]} {...h} />);
    const btn = screen.getByRole("button", { name: "Share" });
    expect(btn.className).not.toMatch(/(^|\s)text-ink/);
    expect(btn.className).toMatch(/text-cream-dim/);
  });

  it("share buttons carry the uppercase action treatment", () => {
    // render one sharing row and one not-sharing row (the file's existing fixtures)
    const h = handlers();
    render(<OnlineList players={[p({}), p({ gamertag: "Other", sharedWithThem: true })]} {...h} />);
    for (const btn of screen.getAllByRole("button", { name: /share|sharing · stop/i })) {
      expect(btn.className).toContain("uppercase");
    }
  });
});
