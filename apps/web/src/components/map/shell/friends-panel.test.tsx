import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FriendsPanel } from "./friends-panel";

const players = [
  { gamertag: "You", friend: false, sharing: true, self: true },
  { gamertag: "Mate", friend: true, sharing: false, self: false },
];
const NOW = new Date("2026-07-22T12:00:00.000Z");

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

  it("counts everyone online INCLUDING the viewer", () => {
    // "Online 3" on a server with three people on it, one of whom is you. Excluding yourself
    // makes the number disagree with the list directly beneath it and with the server's own
    // player count, for no gain — you know whether you are playing.
    render(<FriendsPanel players={players} loading={false} />);
    expect(screen.getByRole("button", { name: /online 2/i })).toBeInTheDocument();
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

  it("can be closed again on a phone, where there is no Escape key", async () => {
    // ⚠️ THE BUG THIS PINS: the sheet is `fixed bottom-0 z-50`, so below md it COVERS the
    // bottom bar that holds the ☰ trigger. Without a close control inside the dialog there is
    // no way out on a touch device — no trigger to tap, no Escape key, and (before this) no
    // backdrop. Reported from a real phone.
    const user = userEvent.setup();
    render(<FriendsPanel players={players} loading={false} now={NOW} />);
    await user.click(screen.getByRole("button", { name: /online/i }));
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: /close/i });
    await user.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the map behind it is tapped", async () => {
    const user = userEvent.setup();
    render(<FriendsPanel players={players} loading={false} now={NOW} />);
    await user.click(screen.getByRole("button", { name: /online/i }));
    await user.click(screen.getByTestId("online-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the backdrop out of the accessibility tree — it is a gesture, not content", () => {
    render(<FriendsPanel players={players} loading={false} now={NOW} />);
    expect(screen.queryByTestId("online-backdrop")).toBeNull();
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
