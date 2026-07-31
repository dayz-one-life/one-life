import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckoutReturn } from "./checkout-return";

const confirmCheckout = vi.fn();
vi.mock("@/lib/api", () => ({ confirmCheckout: (...a: unknown[]) => confirmCheckout(...a) }));

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace }),
  usePathname: () => "/",
}));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CheckoutReturn />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  confirmCheckout.mockReset();
  replace.mockReset();
});

describe("CheckoutReturn", () => {
  it("renders nothing without a checkout param", () => {
    params = new URLSearchParams();
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(confirmCheckout).not.toHaveBeenCalled();
  });
  it("mounts the live region BEFORE confirmCheckout resolves — the pre-existing-region rule", () => {
    params = new URLSearchParams("checkout=cs_1");
    confirmCheckout.mockReturnValue(new Promise(() => {})); // never resolves during this test
    mount();
    // Already in the DOM, not born together with the eventual message.
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
  it("confirms, announces the grant, and strips the param", async () => {
    params = new URLSearchParams("checkout=cs_1");
    confirmCheckout.mockResolvedValue({ granted: 2, paid: true, balance: 5 });
    mount();
    // Two nodes carry the same text once resolved: the pre-existing SrStatus region and the
    // separate visible paragraph — assert both are present rather than one ambiguous match.
    const matches = await screen.findAllByText(/2 tokens added/i);
    expect(matches).toHaveLength(2);
    expect(confirmCheckout).toHaveBeenCalledWith("cs_1");
    expect(replace).toHaveBeenCalledWith("/", { scroll: false });
  });
  it("a paid replay (granted 0) still reads as settled, not as an error", async () => {
    params = new URLSearchParams("checkout=cs_1");
    confirmCheckout.mockResolvedValue({ granted: 0, paid: true, balance: 5 });
    mount();
    expect(await screen.findAllByText(/tokens already added/i)).toHaveLength(2);
  });
  it("an unpaid/unknown session renders processing — never an error, never a zero", async () => {
    params = new URLSearchParams("checkout=cs_1");
    confirmCheckout.mockResolvedValue({ granted: 0, paid: false, balance: 3 });
    mount();
    expect(await screen.findAllByText(/payment processing/i)).toHaveLength(2);
  });
  it("a failed confirm call renders processing too — the webhook is the backstop", async () => {
    params = new URLSearchParams("checkout=cs_1");
    confirmCheckout.mockRejectedValue(new Error("network"));
    mount();
    expect(await screen.findAllByText(/payment processing/i)).toHaveLength(2);
  });
});
