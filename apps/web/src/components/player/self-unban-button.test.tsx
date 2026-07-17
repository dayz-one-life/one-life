import { render, screen } from "@testing-library/react";
import { describe, it, expect, test } from "vitest";
import { UnbanView } from "./self-unban-button";

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
    expect(screen.getByText(/unban pending/i)).toBeInTheDocument();
  });
  it("renders nothing when not owner", () => {
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

  test("pending state renders the mono notice", () => {
    render(<UnbanView state="pending" balance={0} onRedeem={() => {}} />);
    expect(screen.getByText("Unban pending — lifting shortly…")).toBeInTheDocument();
  });
});
