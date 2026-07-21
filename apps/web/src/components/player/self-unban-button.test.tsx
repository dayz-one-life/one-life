import { render, screen } from "@testing-library/react";
import { describe, it, expect, test } from "vitest";
import { UnbanView, unbanStateOf } from "./self-unban-button";

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

  test("unbanStateOf: pending wins, then balance decides", () => {
    expect(unbanStateOf(true, 5)).toBe("pending");
    expect(unbanStateOf(false, 2)).toBe("ready");
    expect(unbanStateOf(false, 0)).toBe("no-tokens");
  });
});
