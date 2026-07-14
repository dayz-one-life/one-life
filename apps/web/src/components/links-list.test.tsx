import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinksList } from "./links-list";

const links = [
  { id: 1, serverId: 2, gamertag: "Ace", status: "verified" as const, verifiedAt: "2026-07-09T12:00:00.000Z", challenge: null },
  { id: 2, serverId: 2, gamertag: "Ben", status: "pending" as const, verifiedAt: null,
    challenge: { sequence: ["Wave", "Salute"], progressIndex: 1, expiresAt: "2026-07-10T12:00:00.000Z", expired: false } },
];

describe("LinksList", () => {
  it("shows each link with its status and a Cancel button only for pending", async () => {
    const onCancel = vi.fn();
    render(<LinksList links={links} onCancel={onCancel} />);
    expect(screen.getByText("Ace")).toBeInTheDocument();
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
    expect(cancelButtons).toHaveLength(1);
    await userEvent.click(cancelButtons[0]!);
    expect(onCancel).toHaveBeenCalledWith(2);
  });

  it("empty state", () => {
    render(<LinksList links={[]} onCancel={() => {}} />);
    expect(screen.getByText(/no gamertag/i)).toBeInTheDocument();
  });
});
