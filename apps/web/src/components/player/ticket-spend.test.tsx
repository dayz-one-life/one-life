import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TicketSpend } from "./ticket-spend";

const redeemToken = vi.fn();
const createCheckout = vi.fn();
vi.mock("@/lib/api", () => ({
  redeemToken: (...a: unknown[]) => redeemToken(...a),
  createCheckout: (...a: unknown[]) => createCheckout(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => { vi.unstubAllEnvs(); redeemToken.mockReset(); createCheckout.mockReset(); });

describe("TicketSpend buy affordance", () => {
  it("offers no buy button when the store is OFF", () => {
    render(<TicketSpend banId={1} liftPending={false} />);
    expect(screen.getByRole("button", { name: /spend 1 token/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /buy a token/i })).not.toBeInTheDocument();
  });
  it("offers a buy button when the store is ON and redirects to checkout", async () => {
    vi.stubEnv("NEXT_PUBLIC_TOKEN_PRICE_LABEL", "$3");
    createCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_9" });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
    render(<TicketSpend banId={1} liftPending={false} />);
    await userEvent.click(screen.getByRole("button", { name: /buy a token — \$3/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs_9"));
  });
  it("hides the buy button while a lift is pending", () => {
    vi.stubEnv("NEXT_PUBLIC_TOKEN_PRICE_LABEL", "$3");
    render(<TicketSpend banId={1} liftPending={true} />);
    expect(screen.queryByRole("button", { name: /buy a token/i })).not.toBeInTheDocument();
  });
});
