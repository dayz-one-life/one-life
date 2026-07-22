import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RosterView, Roster } from "./roster";

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

  it("uses role=\"list\" so Tailwind preflight's list-style:none can't strip the implicit list role", () => {
    render(
      <RosterView
        data={{ friends: [], incoming: [entry(1, "IncomingOne")], outgoing: [], total: 0, page: 1, pageSize: 25 }}
        {...actions}
      />,
    );
    expect(screen.getByRole("list", { name: /requests/i })).toBeInTheDocument();
  });

  it("disables row controls while a mutation is pending", () => {
    render(
      <RosterView
        data={{ friends: [], incoming: [entry(1, "IncomingOne")], outgoing: [], total: 0, page: 1, pageSize: 25 }}
        pending
        {...actions}
      />,
    );
    expect(screen.getByRole("button", { name: /accept/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /decline/i })).toBeDisabled();
  });

  it("requires a confirm step before removing a friend", () => {
    const data = { friends: [entry(2, "FriendOne")], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25 };
    const { rerender } = render(<RosterView data={data} {...actions} />);
    expect(screen.getByRole("button", { name: /^remove$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove friend/i })).toBeNull();
    rerender(<RosterView data={data} confirmingId={2} {...actions} />);
    expect(screen.getByRole("button", { name: /remove friend/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });
});

const { mockAccount, getFriends, acceptFriendRequest } = vi.hoisted(() => ({
  mockAccount: { value: null as unknown },
  getFriends: vi.fn(),
  acceptFriendRequest: vi.fn(),
}));

vi.mock("@/lib/use-account-status", () => ({
  useAccountStatus: () => mockAccount.value,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getFriends: (...a: unknown[]) => getFriends(...a),
    getFriendStatus: vi.fn(),
    sendFriendRequest: vi.fn(),
    acceptFriendRequest: (...a: unknown[]) => acceptFriendRequest(...a),
    declineFriendRequest: vi.fn(),
    deleteFriendship: vi.fn(),
  };
});

describe("Roster container", () => {
  function wrap(ui: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  }

  const feed = { friends: [], incoming: [entry(1, "IncomingOne")], outgoing: [], total: 0, page: 1, pageSize: 25 };

  it("announces success only after a successful accept resolves — never at click time", async () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    getFriends.mockResolvedValue(feed);
    let resolveAccept: () => void = () => {};
    acceptFriendRequest.mockReturnValue(new Promise<void>((res) => { resolveAccept = res; }));
    wrap(<Roster />);

    const acceptBtn = await screen.findByRole("button", { name: /accept/i });
    acceptBtn.click();

    // Not announced synchronously at click time — the mutation hasn't resolved yet.
    expect(screen.queryByText(/friend request accepted/i)).toBeNull();

    resolveAccept();
    await waitFor(() => expect(screen.getByText(/friend request accepted/i)).toBeInTheDocument());
  });

  it("does not announce success on a failed accept, and surfaces the mapped error text", async () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    getFriends.mockResolvedValue(feed);
    const { ApiError } = await import("@/lib/api");
    acceptFriendRequest.mockRejectedValue(new ApiError(409, "already_friends"));
    wrap(<Roster />);

    const acceptBtn = await screen.findByRole("button", { name: /accept/i });
    acceptBtn.click();

    await waitFor(() => expect(screen.getByText(/already friends/i)).toBeInTheDocument());
    expect(screen.queryByText(/friend request accepted/i)).toBeNull();
  });

  it("disables controls while an accept mutation is in flight", async () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    getFriends.mockResolvedValue(feed);
    acceptFriendRequest.mockReturnValue(new Promise<void>(() => {}));
    wrap(<Roster />);

    const acceptBtn = await screen.findByRole("button", { name: /accept/i });
    acceptBtn.click();
    await waitFor(() => expect(acceptBtn).toBeDisabled());
  });
});
