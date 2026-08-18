import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportBlockMenu } from "./report-block-menu";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.mock("@/lib/api", () => ({
  reportAvatar: vi.fn(async () => ({ ok: true })),
  blockPlayer: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => mockStatus.mockReset());

describe("ReportBlockMenu", () => {
  it("renders nothing while account status is loading", () => {
    mockStatus.mockReturnValue({ kind: "loading" });
    const { container } = render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when signed out — both actions would 401", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    const { container } = render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" />);
    expect(container).toBeEmptyDOMElement();
  });

  // ⚠️ Reporting requires a VERIFIED gamertag link server-side (403 not_verified otherwise).
  // Blocking only requires being signed in. A signed-in but unlinked/pending user must still get
  // Block, but never a Report option that would just 403.
  it("offers Block but not Report to a signed-in user without a verified link", async () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.getByRole("menuitem", { name: /block player/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /report avatar/i })).toBeNull();
  });

  it("still withholds Report from a pending (unverified) link", async () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "Ripper" } });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.queryByRole("menuitem", { name: /report avatar/i })).toBeNull();
  });

  it("offers both Report and Block to a verified user when there is an avatar", async () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Ripper" } });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.getByRole("menuitem", { name: /report avatar/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /block player/i })).toBeTruthy();
  });

  it("hides Report avatar when there is no avatar to report, even when verified", async () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Ripper" } });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash={null} />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.queryByRole("menuitem", { name: /report avatar/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /block player/i })).toBeTruthy();
  });

  it("opens the report dialog naming the gamertag", async () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Ripper" } });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /report avatar/i }));
    expect(screen.getByRole("dialog", { name: /report ripper's avatar/i })).toBeTruthy();
  });

  it("opens the block dialog naming the gamertag", async () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /block player/i }));
    expect(screen.getByRole("dialog", { name: /block ripper/i })).toBeTruthy();
  });

  // A real trap, not just an `aria-modal`-shaped attribute: proves the panel's `tabIndex={-1}`
  // is actually wired up (same shipped-bug guard as `shell/nav-menu.tsx`), and that Escape
  // closes the menu rather than only the two dialogs it opens.
  it("moves focus into the menu panel on open and closes it on Escape", async () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(document.activeElement).toBe(screen.getByRole("menu"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
