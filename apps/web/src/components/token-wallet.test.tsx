import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TokenWallet } from "./token-wallet";

const noop = () => {};

describe("TokenWallet", () => {
  it("shows the balance and disables redeem at 0", () => {
    render(<TokenWallet balance={0} onRedeem={noop} onTransfer={noop} onSetReferrer={noop} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /lift my ban/i })).toBeDisabled();
  });

  it("enables redeem and fires onRedeem when there is a token", async () => {
    const onRedeem = vi.fn();
    render(<TokenWallet balance={1} onRedeem={onRedeem} onTransfer={noop} onSetReferrer={noop} />);
    await userEvent.click(screen.getByRole("button", { name: /lift my ban/i }));
    expect(onRedeem).toHaveBeenCalledOnce();
  });

  it("submits a transfer with the entered recipient", async () => {
    const onTransfer = vi.fn();
    render(<TokenWallet balance={1} onRedeem={noop} onTransfer={onTransfer} onSetReferrer={noop} />);
    await userEvent.type(screen.getByLabelText(/transfer recipient/i), "friend-id");
    await userEvent.click(screen.getByRole("button", { name: /transfer/i }));
    expect(onTransfer).toHaveBeenCalledWith("friend-id");
  });
});
