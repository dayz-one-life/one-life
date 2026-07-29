import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { AccountPanels } from "./account-panels";

// The pending branch renders no visible body — the full-bleed `PendingHero` (mounted separately
// above this component, per pending-hero spec §3) owns the challenge UI. This suite pins that
// the section stays mounted (for `VerificationAnnouncer` + sign-out) with no visible panel body.
vi.mock("@/components/account/use-controls", () => ({
  useControls: () => ({
    status: { kind: "pending", link: { id: 1, gamertag: "Boots", challenge: null } },
    name: null,
    provider: null,
    balance: null,
    servers: [],
    standing: [],
    standingLoading: false,
    previousBestSeconds: 0,
    serversLoading: false,
    balanceLoading: false,
  }),
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

describe("AccountPanels: pending branch", () => {
  test("renders the account section, sign-out, and the persistent announcer, but no visible panel body", () => {
    getAvatar.mockResolvedValue({ hash: null });
    wrap(<AccountPanels />);

    expect(screen.getByLabelText("Your account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    // VerificationAnnouncer renders unconditionally as a role="status" region so it survives
    // the pending -> verified swap.
    expect(screen.getByRole("status")).toBeInTheDocument();

    // No visible panel body: the pending surface's UI lives entirely in the separately-mounted
    // PendingHero — nothing here should render a heading, a list, or the challenge copy.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/Prove it's you/i)).toBeNull();
  });
});
