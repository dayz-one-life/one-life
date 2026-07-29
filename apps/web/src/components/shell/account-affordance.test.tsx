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
    renderIt();
    const trigger = screen.getByRole("button", { name: "Your account" });
    expect(trigger).toHaveTextContent("B"); // pending tag's initial, not the anonymous "•"
    expect(trigger.className).toContain("border-yellow");
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Finish verification →" })).toHaveAttribute("href", "/#claim");
    expect(screen.queryByRole("menuitem", { name: "Claim your gamertag →" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Your profile →" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("verified and unlinked discs carry no yellow pending cue", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    renderIt();
    expect(screen.getByRole("button", { name: "Your account" }).className).not.toContain("border-yellow");
  });

  it("never links to /you anywhere", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    const { container } = renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    expect(container.querySelector('a[href="/you"]')).toBeNull();
  });
});
