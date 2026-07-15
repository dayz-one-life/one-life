import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UnbanView } from "./self-unban-button";

describe("UnbanView", () => {
  it("shows spend button when owner has tokens", () => {
    render(<UnbanView state="ready" balance={3} onRedeem={() => {}} />);
    expect(screen.getByRole("button", { name: /spend 1 token/i })).toBeEnabled();
  });
  it("disables when owner has no tokens", () => {
    render(<UnbanView state="no-tokens" balance={0} onRedeem={() => {}} />);
    expect(screen.getByRole("button", { name: /no unban tokens/i })).toBeDisabled();
  });
  it("shows pending state", () => {
    render(<UnbanView state="pending" balance={2} onRedeem={() => {}} />);
    expect(screen.getByText(/unban pending/i)).toBeInTheDocument();
  });
  it("renders nothing when not owner", () => {
    const { container } = render(<UnbanView state="hidden" balance={0} onRedeem={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
