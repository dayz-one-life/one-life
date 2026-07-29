import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { AccountPanels } from "./account-panels";

// The pending branch renders no visible body — the full-bleed `PendingHero` (mounted separately
// above this component, per pending-hero spec §3) owns the challenge UI, and the claim modal owns
// the unlinked claim flow. This suite pins that the section stays mounted (for
// `VerificationAnnouncer`) with no visible panel body and no padding for either state.
const mockKind = vi.fn();

vi.mock("@/components/account/use-controls", () => ({
  useControls: () => mockKind(),
  useControlsActions: () => ({
    claim: { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null },
    cancel: { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null },
    send: { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null },
    redeem: { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null },
  }),
}));

const getAvatar = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getAvatar: (...a: unknown[]) => getAvatar(...a) };
});

vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: vi.fn() }));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const baseControls = {
  name: null,
  provider: null,
  balance: null,
  servers: [],
  standing: [],
  standingLoading: false,
  previousBestSeconds: 0,
  serversLoading: false,
  balanceLoading: false,
};

describe("AccountPanels: pending branch", () => {
  test("stays mounted for the announcer, but renders no visible body, no sign-out, no padding", () => {
    getAvatar.mockResolvedValue({ hash: null });
    mockKind.mockReturnValue({
      ...baseControls,
      status: { kind: "pending", link: { id: 1, gamertag: "Boots", challenge: null } },
    });
    wrap(<AccountPanels />);

    const section = screen.getByLabelText("Your account");
    // VerificationAnnouncer must survive the pending -> verified swap.
    expect(screen.getByRole("status")).toBeInTheDocument();

    // The white-bar bug: an inline Sign out (masthead owns it now) or padding on an otherwise
    // sr-only section renders as a blank paper strip between the hero and the Rules.
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(section.className).not.toContain("py-8");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/Prove it's you/i)).toBeNull();
  });

  test("unlinked also renders no visible body — the claim modal owns the form now", () => {
    getAvatar.mockResolvedValue({ hash: null });
    mockKind.mockReturnValue({ ...baseControls, status: { kind: "unlinked" }, name: null });
    wrap(<AccountPanels />);
    expect(screen.queryByRole("heading", { name: /Link your gamertag/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});
