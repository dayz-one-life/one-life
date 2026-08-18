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
    const { container } = render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when signed out — both actions would 401", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    const { container } = render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed />);
    expect(container).toBeEmptyDOMElement();
  });

  // ⚠️ Reporting requires a VERIFIED gamertag link server-side (403 not_verified otherwise).
  // Blocking only requires being signed in. A signed-in but unlinked/pending user must still get
  // Block, but never a Report option that would just 403.
  it("offers Block but not Report to a signed-in user without a verified link", async () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.getByRole("menuitem", { name: /block player/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /report avatar/i })).toBeNull();
  });

  it("still withholds Report from a pending (unverified) link", async () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "Ripper" } });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.queryByRole("menuitem", { name: /report avatar/i })).toBeNull();
  });

  it("offers both Report and Block to a verified user when there is an avatar", async () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Ripper" } });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.getByRole("menuitem", { name: /report avatar/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /block player/i })).toBeTruthy();
  });

  it("hides Report avatar when there is no avatar to report, even when verified", async () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Ripper" } });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash={null} claimed />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.queryByRole("menuitem", { name: /report avatar/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /block player/i })).toBeTruthy();
  });

  it("opens the report dialog naming the gamertag", async () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Ripper" } });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /report avatar/i }));
    expect(screen.getByRole("dialog", { name: /report ripper's avatar/i })).toBeTruthy();
  });

  it("opens the block dialog naming the gamertag", async () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /block player/i }));
    expect(screen.getByRole("dialog", { name: /block ripper/i })).toBeTruthy();
  });

  // A real trap, not just an `aria-modal`-shaped attribute: proves the panel's `tabIndex={-1}`
  // is actually wired up (same shipped-bug guard as `shell/nav-menu.tsx`), and that Escape
  // closes the menu rather than only the two dialogs it opens.
  it("moves focus into the menu panel on open and closes it on Escape", async () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(document.activeElement).toBe(screen.getByRole("menu"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// ⚠️ `claimed` is the DOSSIER SUBJECT's claim status, not the viewer's — the prop was called
// `verified` and sat inches from `status.kind === "verified"`, which names the opposite subject.
// `blockByGamertag` resolves the target through `verifiedOwnerByGamertag` and 404s
// `unknown_gamertag` for a gamertag nobody has verified. Most players on the board are
// unclaimed, so offering Block on an unclaimed dossier is an action that fails 100% of the
// time, forever — the same dead end the signed-out guard above already refuses to ship.
describe("ReportBlockMenu on an unclaimed dossier", () => {
  it("withholds Block from a player nobody has verified", async () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Me" } });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed={false} />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.queryByRole("menuitem", { name: /block player/i })).toBeNull();
    // Report is unaffected: it names bytes, which exist whether or not anyone claimed the tag.
    expect(screen.getByRole("menuitem", { name: /report avatar/i })).toBeTruthy();
  });

  it("renders no menu button at all when neither action is available", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    const { container } = render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed={false} />);
    // Unlinked viewer -> no Report; unclaimed subject -> no Block. An empty menu behind a "..."
    // button is worse than no button: it reads as a broken feature.
    expect(container).toBeEmptyDOMElement();
  });

  it("still offers Block on a claimed dossier to a viewer with no verified link", async () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ReportBlockMenu gamertag="Ripper" avatarHash="abc" claimed />);
    await userEvent.click(screen.getByRole("button", { name: /actions for ripper/i }));
    expect(screen.getByRole("menuitem", { name: /block player/i })).toBeTruthy();
  });
});
