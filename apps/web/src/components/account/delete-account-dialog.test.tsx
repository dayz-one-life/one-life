import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getTokens = vi.fn();
const deleteAccount = vi.fn();
vi.mock("@/lib/api", () => ({
  getTokens: (...a: unknown[]) => getTokens(...a),
  deleteAccount: (...a: unknown[]) => deleteAccount(...a),
}));
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: vi.fn() }));

import { DeleteAccountDialog } from "./delete-account-dialog";

beforeEach(() => { getTokens.mockReset(); deleteAccount.mockReset(); });

describe("DeleteAccountDialog", () => {
  it("does not show a token number while the balance is still loading", () => {
    getTokens.mockReturnValue(new Promise(() => {})); // never resolves
    render(<DeleteAccountDialog open onClose={() => {}} />);
    expect(screen.queryByText(/tokens? will be forfeited/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete my account$/i })).toBeDisabled();
  });

  // ⚠️ THE BUG THIS GUARDS: rendering "0 tokens will be forfeited" because the FETCH FAILED,
  // while the user actually holds five, is a lie that costs them real money at the moment they
  // are least able to check it. Failed and zero are different renders.
  it("says the balance is unavailable when the fetch fails, never 0", async () => {
    getTokens.mockRejectedValue(new Error("network"));
    render(<DeleteAccountDialog open onClose={() => {}} />);
    await screen.findByText(/couldn't check your token balance/i);
    expect(screen.queryByText(/0 tokens/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete my account$/i })).toBeDisabled();
  });

  it("states the forfeited count once the balance resolves", async () => {
    getTokens.mockResolvedValue({ balance: 5, transactions: [] });
    render(<DeleteAccountDialog open onClose={() => {}} />);
    expect(await screen.findByText(/5 unspent tokens will be forfeited/i)).toBeInTheDocument();
  });

  it("renders a real zero balance as its own case", async () => {
    getTokens.mockResolvedValue({ balance: 0, transactions: [] });
    render(<DeleteAccountDialog open onClose={() => {}} />);
    expect(await screen.findByText(/you have no unspent tokens/i)).toBeInTheDocument();
  });

  it("keeps the confirm button disabled until DELETE is typed exactly", async () => {
    getTokens.mockResolvedValue({ balance: 0, transactions: [] });
    render(<DeleteAccountDialog open onClose={() => {}} />);
    await screen.findByText(/you have no unspent tokens/i);
    const confirm = screen.getByRole("button", { name: /^delete my account$/i });
    const field = screen.getByLabelText(/type delete to confirm/i);

    await userEvent.type(field, "delete");
    expect(confirm).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, "DELETE");
    expect(confirm).toBeEnabled();
  });

  it("calls the endpoint on confirm", async () => {
    getTokens.mockResolvedValue({ balance: 0, transactions: [] });
    deleteAccount.mockResolvedValue({ ok: true, tokensForfeited: 0, gamertagLinksRemoved: 1 });
    render(<DeleteAccountDialog open onClose={() => {}} />);
    await screen.findByText(/you have no unspent tokens/i);
    await userEvent.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: /^delete my account$/i }));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
  });

  it("tells the user when deletion fails and leaves the dialog open", async () => {
    getTokens.mockResolvedValue({ balance: 0, transactions: [] });
    deleteAccount.mockRejectedValue(new Error("boom"));
    render(<DeleteAccountDialog open onClose={() => {}} />);
    await screen.findByText(/you have no unspent tokens/i);
    await userEvent.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: /^delete my account$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't delete your account/i);
  });
});
