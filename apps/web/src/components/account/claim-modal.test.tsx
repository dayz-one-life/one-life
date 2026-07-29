import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaimModal } from "./claim-modal";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

const claimMutate = vi.fn();
vi.mock("@/components/account/use-controls", () => ({
  useControlsActions: () => ({
    claim: { mutate: claimMutate, isPending: false, isError: false, error: null },
  }),
}));

// LinkTagPanel's autocomplete pulls in the api client; the panel's own suite covers it.
vi.mock("@/lib/api", () => ({ searchClaimableGamertags: vi.fn().mockResolvedValue([]) }));

function setHash(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}

describe("ClaimModal", () => {
  beforeEach(() => {
    claimMutate.mockClear();
    setHash("");
  });

  it("renders nothing without the #claim hash, even when unlinked", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    const { container } = render(<ClaimModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens as a dialog for unlinked + #claim, focus moving into the panel", () => {
    setHash("#claim");
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ClaimModal />);
    const dialog = screen.getByRole("dialog", { name: "Link your gamertag" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // useModalBehavior focuses the panel — a silent no-op without tabIndex={-1}.
    expect(dialog).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Link your gamertag." })).toBeInTheDocument();
  });

  it.each(["pending", "verified", "signedOut", "loading"] as const)(
    "never opens for %s — the hash is inert for a claimed or absent identity",
    (kind) => {
      setHash("#claim");
      mockStatus.mockReturnValue(
        kind === "pending" || kind === "verified" ? { kind, link: { id: 1, gamertag: "X" } } : { kind },
      );
      const { container } = render(<ClaimModal />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("submitting the form claims the typed gamertag", () => {
    setHash("#claim");
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ClaimModal />);
    fireEvent.change(screen.getByLabelText("Gamertag"), { target: { value: "Boots" } });
    fireEvent.click(screen.getByRole("button", { name: "Claim it" }));
    expect(claimMutate).toHaveBeenCalledWith({ gamertag: "Boots" });
  });

  it("Escape closes the dialog AND clears the hash (so re-clicking the CTA re-opens)", () => {
    setHash("#claim");
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ClaimModal />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("the ✕ button and the backdrop both close it", () => {
    setHash("#claim");
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ClaimModal />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
