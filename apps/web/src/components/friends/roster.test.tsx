import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RosterView } from "./roster";

const entry = (id: number, gamertag: string) => ({
  id, gamertag, slug: gamertag.toLowerCase(), status: "friends" as const,
  since: "2026-07-01T00:00:00Z",
});
const actions = { onAccept: () => {}, onDecline: () => {}, onRemove: () => {} };

describe("RosterView", () => {
  it("shows a skeleton while loading, never an empty roster", () => {
    render(<RosterView loading {...actions} />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.queryByText(/no friends yet/i)).toBeNull();
  });

  it("distinguishes a failed load from an empty roster", () => {
    render(<RosterView error {...actions} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText(/no friends yet/i)).toBeNull();
  });

  it("says so plainly when the roster really is empty", () => {
    render(<RosterView data={{ friends: [], incoming: [], outgoing: [], total: 0, page: 1, pageSize: 25 }} {...actions} />);
    expect(screen.getByText(/no friends yet/i)).toBeInTheDocument();
  });

  it("lists incoming requests with Accept and Decline", () => {
    render(
      <RosterView
        data={{ friends: [], incoming: [entry(1, "IncomingOne")], outgoing: [], total: 0, page: 1, pageSize: 25 }}
        {...actions}
      />,
    );
    const list = screen.getByRole("list", { name: /requests/i });
    const row = within(list).getByRole("listitem");
    expect(within(row).getByRole("link", { name: "IncomingOne" })).toHaveAttribute("href", "/players/incomingone");
    expect(within(row).getByRole("button", { name: /accept/i })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /decline/i })).toBeInTheDocument();
  });

  it("lists friends with a Remove control and outgoing with Cancel", () => {
    render(
      <RosterView
        data={{
          friends: [entry(2, "FriendOne")], incoming: [],
          outgoing: [entry(3, "PendingOne")], total: 1, page: 1, pageSize: 25,
        }}
        {...actions}
      />,
    );
    const friends = screen.getByRole("list", { name: /friends/i });
    expect(within(friends).getByRole("button", { name: /remove/i })).toBeInTheDocument();
    const outgoing = screen.getByRole("list", { name: /sent/i });
    expect(within(outgoing).getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("announces the last completed action", () => {
    render(<RosterView data={{ friends: [], incoming: [], outgoing: [], total: 0, page: 1, pageSize: 25 }} announcement="Friend request accepted" {...actions} />);
    expect(screen.getByRole("status")).toHaveTextContent("Friend request accepted");
  });
});
