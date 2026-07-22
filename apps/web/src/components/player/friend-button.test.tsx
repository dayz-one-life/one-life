import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FriendView, friendButtonLabel } from "./friend-button";

const noop = () => {};
const actions = { onAdd: noop, onAccept: noop, onDecline: noop, onRemove: noop };

describe("friendButtonLabel", () => {
  it("counts whole days remaining on a cooldown", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    expect(friendButtonLabel("cooldown", "2026-07-08T00:00:00Z", now))
      .toBe("You can send another request in 7 days");
    expect(friendButtonLabel("cooldown", "2026-07-02T06:00:00Z", now))
      .toBe("You can send another request in 1 day");
  });
});

describe("FriendView", () => {
  it("renders a skeleton and no control while loading", () => {
    const { container } = render(<FriendView loading {...actions} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("renders an explicit status line on error, never a default Add friend", () => {
    render(<FriendView error {...actions} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByRole("button", { name: /add friend/i })).toBeNull();
  });

  it("renders nothing when there is no status to show", () => {
    const { container } = render(<FriendView {...actions} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Add friend when unrelated", () => {
    render(<FriendView status="none" {...actions} />);
    expect(screen.getByRole("button", { name: /add friend/i })).toBeInTheDocument();
  });

  it("offers Cancel request on an outgoing request", () => {
    render(<FriendView status="outgoing" {...actions} />);
    expect(screen.getByRole("button", { name: /cancel request/i })).toBeInTheDocument();
  });

  it("offers Accept and Decline on an incoming request", () => {
    render(<FriendView status="incoming" {...actions} />);
    expect(screen.getByRole("button", { name: /^accept$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^decline$/i })).toBeInTheDocument();
  });

  it("requires a confirm step before removing a friend", async () => {
    const { rerender } = render(<FriendView status="friends" {...actions} />);
    expect(screen.getByRole("button", { name: /friends/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove friend/i })).toBeNull();
    rerender(<FriendView status="friends" confirming {...actions} />);
    expect(screen.getByRole("button", { name: /remove friend/i })).toBeInTheDocument();
  });

  it("disables the control during a cooldown and says when", () => {
    render(
      <FriendView
        status="cooldown"
        cooldownUntil="2026-07-08T00:00:00Z"
        now={new Date("2026-07-01T00:00:00Z")}
        {...actions}
      />,
    );
    const btn = screen.getByRole("button", { name: /send another request in 7 days/i });
    expect(btn).toBeDisabled();
  });
});
