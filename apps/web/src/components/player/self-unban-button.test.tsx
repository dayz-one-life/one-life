import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, test, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { UnbanView, unbanStateOf, SelfUnbanButton } from "./self-unban-button";

vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u1" } } }) }));
vi.mock("@/lib/use-gamertag-links", () => ({
  useGamertagLinks: () => ({
    data: [{ id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null }],
  }),
}));
const getTokens = vi.fn();
const redeemToken = vi.fn();
vi.mock("@/lib/api", () => ({
  getTokens: (...a: unknown[]) => getTokens(...a),
  redeemToken: (...a: unknown[]) => redeemToken(...a),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("UnbanView", () => {
  it("shows spend button when owner has tokens", () => {
    render(<UnbanView state="ready" balance={3} onRedeem={() => {}} />);
    expect(screen.getByRole("button", { name: /spend 1 token/i })).toBeEnabled();
  });
  it("disables when owner has no tokens", () => {
    render(<UnbanView state="no-tokens" balance={0} onRedeem={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/no unban tokens/i)).toBeInTheDocument();
  });
  it("shows pending state", () => {
    render(<UnbanView state="pending" balance={2} onRedeem={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/unban pending/i);
  });
  it("renders nothing in the hidden state", () => {
    const { container } = render(<UnbanView state="hidden" balance={0} onRedeem={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("loading state shows a checking affordance, not the no-tokens CTA or a balance claim", () => {
    render(<UnbanView state="loading" balance={0} onRedeem={() => {}} />);
    expect(screen.getByText(/checking your tokens/i)).toBeInTheDocument();
    expect(screen.queryByText(/no unban tokens/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you have 0 unban tokens/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("ready state renders the canvas CTA and balance line", () => {
    render(<UnbanView state="ready" balance={3} onRedeem={() => {}} />);
    expect(screen.getByRole("button", { name: "Spend 1 token — skip the wait" })).toBeInTheDocument();
    expect(screen.getByText("You have 3 unban tokens")).toBeInTheDocument();
  });

  test("no-tokens state renders the red-deep notice, no button", () => {
    render(<UnbanView state="no-tokens" balance={0} onRedeem={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("No unban tokens").className).toContain("text-red-deep");
    expect(screen.getByText("Earn tokens monthly, by referral, or on verification")).toBeInTheDocument();
  });

  test("pending state renders the mono notice as a role=status announcement", () => {
    render(<UnbanView state="pending" balance={0} onRedeem={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Unban pending — lifting shortly…");
  });

  test("the status region pre-exists the ready state and announces on the ready -> pending transition", () => {
    const { rerender } = render(<UnbanView state="ready" balance={3} onRedeem={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");
    rerender(<UnbanView state="pending" balance={3} onRedeem={() => {}} />);
    // Same node — the live region was already in the DOM before its text changed, not born
    // together with the pending message.
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Unban pending — lifting shortly…");
  });

  test("unbanStateOf: pending wins, then balance decides", () => {
    expect(unbanStateOf(true, 5)).toBe("pending");
    expect(unbanStateOf(false, 2)).toBe("ready");
    expect(unbanStateOf(false, 0)).toBe("no-tokens");
  });

  test("unbanStateOf: unresolved balance is 'loading', never a fabricated no-tokens/ready", () => {
    expect(unbanStateOf(false, 0, false)).toBe("loading");
    expect(unbanStateOf(false, 5, false)).toBe("loading");
    // Lift-already-pending still wins even while the balance is unresolved.
    expect(unbanStateOf(true, 0, false)).toBe("pending");
  });
});

describe("SelfUnbanButton: loading/error must not fabricate a resolved balance", () => {
  beforeEach(() => {
    getTokens.mockReset();
    redeemToken.mockReset();
  });

  it("does not render '0 tokens' or the no-tokens CTA while the tokens query is loading", () => {
    getTokens.mockReturnValue(new Promise(() => {})); // never resolves during this test
    wrap(<SelfUnbanButton banId={1} pageGamertag="Boots" liftPending={false} />);
    expect(screen.getByText(/checking your tokens/i)).toBeInTheDocument();
    expect(screen.queryByText(/no unban tokens/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you have 0 unban tokens/i)).not.toBeInTheDocument();
  });

  it("does not render '0 tokens' or the no-tokens CTA when the tokens query errors", async () => {
    getTokens.mockRejectedValue(new Error("network down"));
    wrap(<SelfUnbanButton banId={1} pageGamertag="Boots" liftPending={false} />);
    await waitFor(() => expect(screen.getByText(/checking your tokens/i)).toBeInTheDocument());
    expect(screen.queryByText(/no unban tokens/i)).not.toBeInTheDocument();
  });

  it("still shows a genuinely-resolved zero balance as 'no unban tokens'", async () => {
    getTokens.mockResolvedValue({ balance: 0 });
    wrap(<SelfUnbanButton banId={1} pageGamertag="Boots" liftPending={false} />);
    await waitFor(() => expect(screen.getByText(/no unban tokens/i)).toBeInTheDocument());
  });

  it("still shows a genuinely-resolved positive balance as ready to spend", async () => {
    getTokens.mockResolvedValue({ balance: 2 });
    wrap(<SelfUnbanButton banId={1} pageGamertag="Boots" liftPending={false} />);
    await waitFor(() => expect(screen.getByText("You have 2 unban tokens")).toBeInTheDocument());
  });
});
