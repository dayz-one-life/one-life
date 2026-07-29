import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountAffordance } from "./account-affordance";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));
const teardown = vi.fn();
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: () => teardown() }));
vi.mock("@/lib/api", () => ({ getAvatar: vi.fn().mockResolvedValue({ hash: null }) }));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AccountAffordance /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe("AccountAffordance", () => {
  it("renders nothing while loading and a Sign in chip when signed out", () => {
    mockStatus.mockReturnValue({ kind: "loading" });
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
    mockStatus.mockReturnValue({ kind: "signedOut" });
    renderIt();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("verified: the disc is a menu button opening profile + sign out", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    renderIt();
    const trigger = screen.getByRole("button", { name: "Your account" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Your profile →" })).toHaveAttribute("href", "/players/yrjustbad");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(teardown).toHaveBeenCalled();
  });

  it("unlinked: claim link instead of profile, sign out still present", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    expect(screen.getByRole("menuitem", { name: "Claim your gamertag →" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Your profile →" })).not.toBeInTheDocument();
  });

  it("Escape closes and the panel is focusable (tabIndex -1)", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens with focus on the first item, and ArrowDown moves to Sign out", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    const first = screen.getByRole("menuitem", { name: "Your profile →" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  });

  it("pending: Finish verification link to /#claim, disc shows the tag initial with the yellow cue", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "boots" } });
    const { container } = renderIt();
    const trigger = screen.getByRole("button", { name: "Your account" });
    expect(trigger).toHaveTextContent("B"); // pending tag's initial, not the anonymous "•"
    // The cue lives on the Avatar's ring, not the button — the button no longer draws a border.
    // Asserting it on the trigger would pass vacuously against a cue that had silently vanished.
    expect(container.querySelector('[aria-hidden="true"]')!.className).toContain("border-yellow");
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Finish verification →" })).toHaveAttribute("href", "/#claim");
    expect(screen.queryByRole("menuitem", { name: "Claim your gamertag →" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Your profile →" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it.each(["verified", "unlinked"] as const)("%s disc carries no yellow pending cue", (kind) => {
    mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
    const { container } = renderIt();
    // Same subject as the positive case above: the ring on the Avatar, not the button. Asserted
    // on the button this would be vacuously true and would never catch an always-yellow cue.
    const disc = container.querySelector('[aria-hidden="true"]')!;
    expect(disc.className).not.toContain("border-yellow");
    expect(disc.className).toContain("border-dark-edge-bright");
  });

  it("never links to /you anywhere", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    const { container } = renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    expect(container.querySelector('a[href="/you"]')).toBeNull();
  });

  // The masthead is DARK. Rendering through Avatar without variant="dark" produces the
  // paper tokens — ink on dark, i.e. present, functional and invisible (the v0.26.0 bug).
  it("renders the avatar through the shared Avatar on the dark variant", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    const { container } = renderIt();
    const disc = container.querySelector('[aria-hidden="true"]')!;
    expect(disc.className).toContain("rounded-full");
    expect(disc.className).toContain("bg-dark-well");
    expect(disc.className).toContain("text-paper");
    expect(disc.className).not.toContain("bg-bone");
    // The hover state must survive the collapse — it now reaches Avatar via `group`.
    expect(disc.className).toContain("group-hover:border-red");
    expect(container.querySelector("button")!.className).toContain("group");
  });
});
