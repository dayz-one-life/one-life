import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuyTokensButton } from "./buy-tokens";

const createCheckout = vi.fn();
vi.mock("@/lib/api", () => ({ createCheckout: (...a: unknown[]) => createCheckout(...a) }));

afterEach(() => {
  vi.unstubAllEnvs();
  createCheckout.mockReset();
});

describe("BuyTokensButton", () => {
  it("renders nothing when the price label is unset (store OFF)", () => {
    const { container } = render(<BuyTokensButton />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows the price and redirects to the hosted checkout", async () => {
    vi.stubEnv("NEXT_PUBLIC_TOKEN_PRICE_LABEL", "$3");
    createCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_1" });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
    render(<BuyTokensButton />);
    const btn = screen.getByRole("button", { name: /buy tokens — \$3 each/i });
    await userEvent.click(btn);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs_1"));
  });
  it("re-enables and keeps its label when checkout creation fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_TOKEN_PRICE_LABEL", "$3");
    createCheckout.mockRejectedValue(new Error("503"));
    render(<BuyTokensButton />);
    await userEvent.click(screen.getByRole("button", { name: /buy tokens/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /buy tokens/i })).toBeEnabled());
  });
});
