import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FriendsPanel } from "./friends-panel";

const NOW = new Date("2026-07-22T12:00:00Z");
const positions = [
  { gamertag: "You", x: 1, y: 2, recordedAt: "2026-07-22T11:59:00Z", self: true },
  { gamertag: "Mate", x: 3, y: 4, recordedAt: "2026-07-22T11:50:00Z", self: false },
];

describe("FriendsPanel", () => {
  it("opens a list of who is sharing, with each dot's own age", async () => {
    render(<FriendsPanel positions={positions} loading={false} now={NOW} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /friends/i }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/10m ago/)).toBeInTheDocument();
  });

  it("counts only friends, not your own dot", () => {
    render(<FriendsPanel positions={positions} loading={false} now={NOW} />);
    expect(screen.getByRole("button", { name: /friends 1/i })).toBeInTheDocument();
  });

  it("shows a loading state instead of a fabricated zero", () => {
    render(<FriendsPanel positions={undefined} loading now={NOW} />);
    expect(screen.getByRole("button", { name: /friends/i })).not.toHaveAccessibleName(/friends 0/i);
  });

  it("says plainly when nobody is sharing", async () => {
    render(<FriendsPanel positions={[]} loading={false} now={NOW} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /friends/i }));
    expect(screen.getByText(/nobody is sharing/i)).toBeInTheDocument();
  });

  it("does not report a failed fetch as an empty map", async () => {
    // "Nobody is sharing" is a claim about the game. A network error is not evidence for it,
    // and the page's own overlay card already says the load failed.
    render(<FriendsPanel positions={undefined} loading={false} error now={NOW} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /friends/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText(/nobody is sharing/i)).toBeNull();
  });

  it("moves focus into the sheet it opens", async () => {
    // useModalBehavior focuses the panel; without tabIndex={-1} that is a silent no-op and
    // the sheet opens with focus left on the trigger behind it.
    render(<FriendsPanel positions={positions} loading={false} now={NOW} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /friends/i }));
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("uses dark tokens — it is mounted on the dark bar, not the light rail", () => {
    const { container } = render(<FriendsPanel positions={positions} loading={false} now={NOW} />);
    expect(container.querySelector("button")!.className).toMatch(/text-paper/);
  });
});
