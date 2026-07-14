import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClaimForm } from "./claim-form";

const servers = [
  { id: 1, nitradoServiceId: 1, name: "Alpha", map: "chernarusplus", slug: null, active: true, clockOffsetMs: 0, createdAt: "" },
];

describe("ClaimForm", () => {
  it("submits the chosen server and gamertag", async () => {
    const onSubmit = vi.fn();
    render(<ClaimForm servers={servers} pending={false} error={null} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/gamertag/i), "Ace");
    await userEvent.click(screen.getByRole("button", { name: /claim/i }));
    expect(onSubmit).toHaveBeenCalledWith(1, "Ace");
  });

  it("shows an error message when provided", () => {
    render(<ClaimForm servers={servers} pending={false} error="We haven't seen that gamertag on this server yet." onSubmit={() => {}} />);
    expect(screen.getByText(/haven't seen that gamertag/i)).toBeInTheDocument();
  });
});
