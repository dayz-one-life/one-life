import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useAccountStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({
  useAccountStatus: () => useAccountStatus(),
}));

// BlockedUsers fetches on mount whenever SettingsBody renders the signed-in branch — mock the
// module so the verified-branch tests don't hit the real network client or leave the fetch
// promise unresolved across test boundaries.
vi.mock("@/lib/api", () => ({
  getBlocks: vi.fn(async () => ({ blocks: [] })),
  unblockPlayer: vi.fn(async () => ({ ok: true })),
}));

import { SettingsBody } from "./settings-body";

describe("SettingsBody", () => {
  // ⚠️ `/settings` is a public URL — only the nav link is behind the signed-in branch. A
  // signed-out visitor must get a sign-in prompt, not the Danger zone (which would let them
  // "confirm" a delete and then 401 on the token-balance check).
  it("does not render the Danger zone when signed out", () => {
    useAccountStatus.mockReturnValue({ kind: "signedOut" });
    render(<SettingsBody />);
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete account/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("renders nothing while status is loading", () => {
    useAccountStatus.mockReturnValue({ kind: "loading" });
    const { container } = render(<SettingsBody />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Danger zone once verified", async () => {
    useAccountStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Steve" } });
    render(<SettingsBody />);
    expect(screen.getByText(/danger zone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete account/i })).toBeInTheDocument();
    // Let BlockedUsers' fetch-on-mount settle so its state update happens inside `act`.
    expect(await screen.findByText(/haven't blocked anyone/i)).toBeInTheDocument();
  });
});
