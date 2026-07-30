import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const controls = {
  status: { kind: "verified", link: { gamertag: "Manicdote" } },
  balance: 3 as number | null,
  balanceLoading: false,
};
const referrals = { data: { joined: 2 } as { joined: number } | undefined, isLoading: false, isError: false };

vi.mock("./use-controls", () => ({
  useControls: () => controls,
  useControlsActions: () => ({ send: { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false } }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => referrals }));

const { ControlsSlab } = await import("./controls-slab");

beforeEach(() => {
  controls.balance = 3;
  controls.balanceLoading = false;
  referrals.data = { joined: 2 };
  referrals.isLoading = false;
  referrals.isError = false;
  vi.stubGlobal("location", { origin: "https://dayzonelife.com" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<ControlsSlab />", () => {
  it("keeps the two-column split at lg, never md", () => {
    const { container } = render(<ControlsSlab />);
    const grid = container.querySelector(".grid");
    expect(grid?.className).toContain("lg:grid-cols-2");
    expect(grid?.className).not.toContain("md:grid-cols-2");
  });

  it("renders balance and join count as inline figures, not display numerals", () => {
    render(<ControlsSlab />);
    expect(screen.getByText("3")).toHaveClass("text-xl");
    expect(screen.getByText(/in hand/i)).toBeInTheDocument();
    expect(screen.getByText(/joined so far/i)).toBeInTheDocument();
  });

  it("shows loading, not a zero balance, while the query is in flight", () => {
    controls.balance = null;
    controls.balanceLoading = true;
    render(<ControlsSlab />);
    expect(screen.queryByText(/in hand/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("shows loading, not a zero join count, while the referral query is in flight", () => {
    referrals.data = undefined;
    referrals.isLoading = true;
    render(<ControlsSlab />);
    expect(screen.queryByText(/joined so far/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("builds the invite link from the viewer's own slug", () => {
    render(<ControlsSlab />);
    expect(screen.getByLabelText("Your invite link")).toHaveValue(
      "https://dayzonelife.com/i/manicdote",
    );
  });
});
