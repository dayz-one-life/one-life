import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountAffordance } from "./account-affordance";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.mock("@/lib/api", () => ({ getAvatar: vi.fn().mockResolvedValue({ hash: null }) }));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AccountAffordance /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe("AccountAffordance", () => {
  // ⚠️ Loading, failed, empty and zero are four different renders. Rendering the signed-out
  // chip while the session is still resolving means it gets swapped for an avatar a frame
  // later, which is how a player learns not to trust the chrome.
  it("renders nothing while loading", () => {
    mockStatus.mockReturnValue({ kind: "loading" });
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });

  it("signed out: a visible Sign in link, not buried in the menu", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    renderIt();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  // ⚠️ The disc is a LINK to home now, not a menu button. Its old popover moved wholesale into
  // shell/nav-menu.tsx — there is exactly one menu in the masthead.
  it("signed in: the disc is a link to home, and no menu button anywhere", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    renderIt();
    expect(screen.getByRole("link", { name: /your home/i })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("pending: shows the tag initial with the yellow cue on the ring", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "boots" } });
    const { container } = renderIt();
    expect(screen.getByRole("link", { name: /your home/i })).toHaveTextContent("B");
    // The cue lives on the Avatar's ring, not the anchor — asserting it on the anchor would
    // pass vacuously against a cue that had silently vanished.
    expect(container.querySelector('[aria-hidden="true"]')!.className).toContain("border-yellow");
  });

  it.each(["verified", "unlinked"] as const)("%s disc carries no yellow pending cue", (kind) => {
    mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
    const { container } = renderIt();
    const disc = container.querySelector('[aria-hidden="true"]')!;
    expect(disc.className).not.toContain("border-yellow");
    expect(disc.className).toContain("border-dark-edge-bright");
  });

  it("unlinked: an anonymous disc that still goes home", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    renderIt();
    expect(screen.getByRole("link", { name: /your home/i })).toHaveTextContent("•");
  });

  // The masthead is DARK. Rendering through Avatar without variant="dark" produces the paper
  // tokens — ink on dark, i.e. present, functional and invisible (the v0.26.0 bug).
  it("renders the avatar through the shared Avatar on the dark variant", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    const { container } = renderIt();
    const disc = container.querySelector('[aria-hidden="true"]')!;
    expect(disc.className).toContain("rounded-full");
    expect(disc.className).toContain("bg-dark-well");
    expect(disc.className).toContain("text-paper");
    expect(disc.className).not.toContain("bg-bone");
    // The hover state reaches Avatar via `group` on the anchor.
    expect(disc.className).toContain("group-hover:border-red");
    expect(container.querySelector("a")!.className).toContain("group");
  });

  it("never links to /you anywhere", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    const { container } = renderIt();
    expect(container.querySelector('a[href="/you"]')).toBeNull();
  });
});
