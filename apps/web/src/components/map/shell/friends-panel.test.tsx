import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FriendsPanel } from "./friends-panel";

const players = [
  { gamertag: "You", friend: false, sharing: true, self: true },
  { gamertag: "Mate", friend: true, sharing: false, self: false },
];

describe("FriendsPanel", () => {
  it("opens a list of who is online", async () => {
    render(<FriendsPanel players={players} loading={false} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /online/i }));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // The viewer's own row is marked with the "(you)" suffix, not merely findable by gamertag —
    // matching on the gamertag text alone would pass even if the suffix silently vanished.
    expect(items[0]).toHaveTextContent(/\(you\)/i);
    expect(screen.getByText(/mate/i)).toBeInTheDocument();
  });

  it("passes fixes through so a sharer's row can show its age", async () => {
    const positions = [
      { gamertag: "You", x: 0, y: 0, recordedAt: "2026-07-22T11:59:00.000Z", self: true },
    ];
    const now = new Date("2026-07-22T12:00:00.000Z");
    render(<FriendsPanel players={players} positions={positions} now={now} loading={false} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /online/i }));
    expect(screen.getByText(/on the map · 1m ago/i)).toBeInTheDocument();
  });

  it("counts players online, excluding the viewer", () => {
    render(<FriendsPanel players={players} loading={false} />);
    expect(screen.getByRole("button", { name: /online 1/i })).toBeInTheDocument();
  });

  it("shows a loading state instead of a fabricated zero", () => {
    render(<FriendsPanel players={undefined} loading />);
    expect(screen.getByRole("button", { name: /online/i })).not.toHaveAccessibleName(/online 0/i);
  });

  it("says plainly when nobody is online", async () => {
    render(<FriendsPanel players={[]} loading={false} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /online/i }));
    expect(screen.getByText(/nobody is on this server/i)).toBeInTheDocument();
  });

  it("does not report a failed fetch as an empty server", async () => {
    // "Nobody is online" is a claim about the game. A network error is not evidence for it,
    // and the page's own overlay card already says the load failed.
    render(<FriendsPanel players={undefined} loading={false} error />);
    await userEvent.setup().click(screen.getByRole("button", { name: /online/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText(/nobody is on this server/i)).toBeNull();
  });

  it("moves focus into the sheet it opens", async () => {
    // useModalBehavior focuses the panel; without tabIndex={-1} that is a silent no-op and
    // the sheet opens with focus left on the trigger behind it.
    render(<FriendsPanel players={players} loading={false} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /online/i }));
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("uses dark tokens — it is mounted on the dark bar, not the light rail", () => {
    const { container } = render(<FriendsPanel players={players} loading={false} />);
    expect(container.querySelector("button")!.className).toMatch(/text-paper/);
  });
});
