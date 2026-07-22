import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { FriendView, friendButtonLabel, FriendButton } from "./friend-button";
import { friendErrorMessage } from "@/components/friends/format";

const noop = () => {};
const actions = { onAdd: noop, onAccept: noop, onDecline: noop, onRemove: noop };

describe("friendButtonLabel", () => {
  it("counts whole days remaining on a cooldown", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    expect(friendButtonLabel("cooldown", "2026-07-08T00:00:00Z", now))
      .toBe("You can send another request in 7 days");
    expect(friendButtonLabel("cooldown", "2026-07-02T06:00:00Z", now))
      .toBe("You can send another request in 2 days");
  });

  it("returns empty once the cooldown has actually expired, never a stale floor of 1 day", () => {
    const now = new Date("2026-07-08T00:00:01Z");
    expect(friendButtonLabel("cooldown", "2026-07-08T00:00:00Z", now)).toBe("");
    expect(friendButtonLabel("cooldown", "2026-07-01T00:00:00Z", now)).toBe("");
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

  it("offers Add friend, not a stale disabled cooldown label, once the cooldown has expired", () => {
    render(
      <FriendView
        status="cooldown"
        cooldownUntil="2026-07-01T00:00:00Z"
        now={new Date("2026-07-08T00:00:00Z")}
        {...actions}
      />,
    );
    expect(screen.getByRole("button", { name: /add friend/i })).not.toBeDisabled();
    expect(screen.queryByText(/send another request/i)).toBeNull();
  });

  it("surfaces a failed mutation as a status line beside the control, not a silent re-enable", () => {
    render(<FriendView status="none" errorCode="already_friends" {...actions} />);
    expect(screen.getByRole("button", { name: /add friend/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/already friends/i);
  });

  it("renders no error line when there is no error code", () => {
    render(<FriendView status="none" {...actions} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a way back out of the remove-friend confirm step", () => {
    const onConfirmToggle = vi.fn();
    render(<FriendView status="friends" confirming onConfirmToggle={onConfirmToggle} {...actions} />);
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    cancel.click();
    expect(onConfirmToggle).toHaveBeenCalled();
  });
});

describe("friendErrorMessage", () => {
  it("maps known codes to short human sentences", () => {
    expect(friendErrorMessage("rate_limited")).toMatch(/too many|try again/i);
    expect(friendErrorMessage("cooldown_active")).toMatch(/wait/i);
    expect(friendErrorMessage("already_friends")).toMatch(/already friends/i);
    expect(friendErrorMessage("already_pending")).toMatch(/already pending|already sent/i);
    expect(friendErrorMessage("not_verified")).toMatch(/verified/i);
    expect(friendErrorMessage("self_request")).toMatch(/yourself/i);
  });

  it("falls back to a generic message for an unknown code", () => {
    expect(friendErrorMessage("some_new_code")).toMatch(/went wrong|try again/i);
  });

  it("returns null when there is nothing to report", () => {
    expect(friendErrorMessage(null)).toBeNull();
    expect(friendErrorMessage(undefined)).toBeNull();
  });
});

const { mockAccount, getFriendStatus, sendFriendRequest } = vi.hoisted(() => ({
  mockAccount: { value: null as unknown },
  getFriendStatus: vi.fn(),
  sendFriendRequest: vi.fn(),
}));

vi.mock("@/lib/use-account-status", () => ({
  useAccountStatus: () => mockAccount.value,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getFriendStatus: (...a: unknown[]) => getFriendStatus(...a),
    getFriends: vi.fn(),
    sendFriendRequest: (...a: unknown[]) => sendFriendRequest(...a),
    acceptFriendRequest: vi.fn(),
    declineFriendRequest: vi.fn(),
    deleteFriendship: vi.fn(),
  };
});

describe("FriendButton container gates", () => {
  function wrap(ui: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  }

  it("renders nothing on the viewer's own profile, compared case-insensitively", () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    const { container } = wrap(<FriendButton gamertag="BOOTS" />);
    expect(container).toBeEmptyDOMElement();
    expect(getFriendStatus).not.toHaveBeenCalled();
  });

  it("fetches and renders normally when viewing another verified player", async () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    getFriendStatus.mockResolvedValue({ status: "none", friendshipId: null, cooldownUntil: null });
    wrap(<FriendButton gamertag="SomeoneElse" />);
    expect(await screen.findByRole("button", { name: /add friend/i })).toBeInTheDocument();
    expect(getFriendStatus).toHaveBeenCalledWith("SomeoneElse");
  });

  it("announces success only once a send-request mutation resolves, same as the Roster", async () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    getFriendStatus.mockResolvedValue({ status: "none", friendshipId: null, cooldownUntil: null });
    let resolveSend: () => void = () => {};
    sendFriendRequest.mockReturnValue(new Promise<void>((res) => { resolveSend = res; }));
    wrap(<FriendButton gamertag="SomeoneElse" />);

    const addBtn = await screen.findByRole("button", { name: /add friend/i });
    addBtn.click();

    // Not announced synchronously at click time — the mutation hasn't resolved yet.
    expect(screen.queryByText(/friend request sent/i)).toBeNull();

    resolveSend();
    await waitFor(() => expect(screen.getByText(/friend request sent/i)).toBeInTheDocument());
  });
});
