import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RosterView, Roster } from "./roster";

const entry = (id: number, gamertag: string) => ({
  id, gamertag, slug: gamertag.toLowerCase(), status: "friends" as const,
  since: "2026-07-01T00:00:00Z",
});
const actions = { onAccept: () => {}, onDecline: () => {}, onRemove: () => {}, onCancel: () => {} };

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

  // Withdrawing your own un-answered outgoing request is not "removing a friend" — it fires
  // the distinct onCancel callback so the container can announce "Friend request canceled"
  // rather than "Removed" (matching FriendButton, which already distinguishes the two).
  it("cancelling a sent request fires onCancel, not onRemove", () => {
    const onRemove = vi.fn();
    const onCancel = vi.fn();
    render(
      <RosterView
        data={{ friends: [], incoming: [], outgoing: [entry(3, "PendingOne")], total: 0, page: 1, pageSize: 25 }}
        {...actions}
        onRemove={onRemove}
        onCancel={onCancel}
      />,
    );
    screen.getByRole("button", { name: /cancel/i }).click();
    expect(onCancel).toHaveBeenCalledWith(3);
    expect(onRemove).not.toHaveBeenCalled();
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

  it("offers a pager for the friends list once it spans more than one page", () => {
    const friends = Array.from({ length: 25 }, (_, i) => entry(i + 1, `Friend${i + 1}`));
    render(
      <RosterView
        data={{ friends, incoming: [], outgoing: [], total: 30, page: 1, pageSize: 25 }}
        {...actions}
      />,
    );
    expect(screen.getByText(/showing 1–25 of 30/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });

  it("never paginates the incoming or outgoing sections", () => {
    render(
      <RosterView
        data={{
          friends: [], incoming: [entry(1, "InOne")], outgoing: [entry(2, "OutOne")],
          total: 0, page: 1, pageSize: 25,
        }}
        {...actions}
      />,
    );
    expect(screen.queryByText(/showing .* of/i)).toBeNull();
  });

  it("says who's signed in only once resolved — never a blank page for a signed-out visitor", () => {
    render(<RosterView signedOut {...actions} />);
    expect(screen.getAllByText(/sign in/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no friends yet/i)).toBeNull();
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
    return { ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>), qc };
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

  it("shows a sign-in prompt for a signed-out visitor, not a blank page", async () => {
    mockAccount.value = { kind: "signedOut" };
    getFriends.mockResolvedValue(feed);
    wrap(<Roster />);
    expect((await screen.findAllByText(/sign in/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no friends yet/i)).toBeNull();
  });

  it("shows a loading state while account status is still resolving, not a blank page", () => {
    mockAccount.value = { kind: "loading" };
    getFriends.mockResolvedValue(feed);
    wrap(<Roster />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  // ⚠️ Regression guard: `page` is local state with no other feedback loop back to the
  // server total. 26 friends on page 2, remove the last one on that page — total drops to 25
  // — and without a clamp, page 2 renders an empty Friends section forever (a single real
  // page means FriendsPagination also returns null, so there is no control back to page 1).
  it("clamps back to a real page once a removal shrinks the roster out from under it", async () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    const page1Friends = Array.from({ length: 25 }, (_, i) => entry(i + 1, `Friend${i + 1}`));
    getFriends.mockImplementation((page: number) =>
      Promise.resolve(
        page === 1
          ? { friends: page1Friends, incoming: [], outgoing: [], total: 26, page: 1, pageSize: 25 }
          : { friends: [entry(26, "Friend26")], incoming: [], outgoing: [], total: 26, page: 2, pageSize: 25 },
      ),
    );
    const { qc } = wrap(<Roster />);

    const nextBtn = await screen.findByRole("button", { name: /next/i });
    nextBtn.click();
    await screen.findByRole("link", { name: "Friend26" });

    // Simulate the server-side effect of removing that last friend on page 2: total drops to
    // 25 (one full page), and page 2 now has no rows.
    qc.setQueryData(["friends", 2], { friends: [], incoming: [], outgoing: [], total: 25, page: 2, pageSize: 25 });

    // The roster clamps back to page 1 (already cached) rather than rendering an empty
    // section with no way back.
    await screen.findByRole("link", { name: "Friend1" });
    expect(screen.queryByText(/no friends yet/i)).toBeNull();
  });
});
