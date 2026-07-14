import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClaimForm } from "./claim-form";
import { searchClaimableGamertags } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  searchClaimableGamertags: vi.fn(),
}));

describe("ClaimForm", () => {
  beforeEach(() => {
    vi.mocked(searchClaimableGamertags).mockReset();
  });

  it("renders no server dropdown", () => {
    render(<ClaimForm pending={false} error={null} onSubmit={() => {}} />);
    expect(screen.queryByLabelText(/server/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows suggestions from the search API when typing 2+ chars", async () => {
    vi.mocked(searchClaimableGamertags).mockResolvedValue(["AceHunter", "AceOfSpades"]);
    render(<ClaimForm pending={false} error={null} onSubmit={() => {}} />);
    await userEvent.type(screen.getByLabelText(/gamertag/i), "Ace");

    await waitFor(() => expect(searchClaimableGamertags).toHaveBeenCalledWith("Ace"));
    expect(await screen.findByText("AceHunter")).toBeInTheDocument();
    expect(screen.getByText("AceOfSpades")).toBeInTheDocument();
  });

  it("does not search below 2 characters", async () => {
    render(<ClaimForm pending={false} error={null} onSubmit={() => {}} />);
    await userEvent.type(screen.getByLabelText(/gamertag/i), "A");
    await new Promise((r) => setTimeout(r, 300));
    expect(searchClaimableGamertags).not.toHaveBeenCalled();
  });

  it("clicking a suggestion then submitting calls onSubmit with that gamertag", async () => {
    vi.mocked(searchClaimableGamertags).mockResolvedValue(["AceHunter"]);
    const onSubmit = vi.fn();
    render(<ClaimForm pending={false} error={null} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/gamertag/i), "Ace");
    const suggestion = await screen.findByText("AceHunter");
    await userEvent.click(suggestion);
    await userEvent.click(screen.getByRole("button", { name: /claim/i }));
    expect(onSubmit).toHaveBeenCalledWith("AceHunter");
  });

  it("shows an error message when provided", () => {
    render(<ClaimForm pending={false} error="We haven't seen that gamertag on any server yet." onSubmit={() => {}} />);
    expect(screen.getByText(/haven't seen that gamertag/i)).toBeInTheDocument();
  });
});
