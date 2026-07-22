import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RosterView, Roster } from "./roster";

const entry = (id: number, gamertag: string) => ({
  id, gamertag, slug: gamertag.toLowerCase(), status: "friends" as const,
  since: "2026-07-01T00:00:00Z", sharesPresence: false, notifyPresence: false,
  sharesLocation: false, theyShareLocation: false,
});
const actions = { onAccept: () => {}, onDecline: () => {}, onRemove: () => {}, onCancel: () => {} };

const withPresence = { ...entry(2, "FriendOne"), sharesPresence: true, notifyPresence: false };
const withLocation = { ...entry(2, "FriendOne"), sharesLocation: true, theyShareLocation: true };

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
    render(<RosterView data={{ friends: [], incoming: [], outgoing: [], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }} {...actions} />);
    expect(screen.getByText(/no friends yet/i)).toBeInTheDocument();
  });

  it("lists incoming requests with Accept and Decline", () => {
    render(
      <RosterView
        data={{ friends: [], incoming: [entry(1, "IncomingOne")], outgoing: [], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }}
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
          outgoing: [entry(3, "PendingOne")], total: 1, page: 1, pageSize: 25, sharePresence: false, shareLocation: false,
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
        data={{ friends: [], incoming: [], outgoing: [entry(3, "PendingOne")], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }}
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
    render(<RosterView data={{ friends: [], incoming: [], outgoing: [], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }} announcement="Friend request accepted" {...actions} />);
    expect(screen.getByRole("status")).toHaveTextContent("Friend request accepted");
  });

  it("uses role=\"list\" so Tailwind preflight's list-style:none can't strip the implicit list role", () => {
    render(
      <RosterView
        data={{ friends: [], incoming: [entry(1, "IncomingOne")], outgoing: [], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }}
        {...actions}
      />,
    );
    expect(screen.getByRole("list", { name: /requests/i })).toBeInTheDocument();
  });

  it("disables row controls while a mutation is pending", () => {
    render(
      <RosterView
        data={{ friends: [], incoming: [entry(1, "IncomingOne")], outgoing: [], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }}
        pending
        {...actions}
      />,
    );
    expect(screen.getByRole("button", { name: /accept/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /decline/i })).toBeDisabled();
  });

  it("requires a confirm step before removing a friend", () => {
    const data = { friends: [entry(2, "FriendOne")], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25, sharePresence: false, shareLocation: false };
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
        data={{ friends, incoming: [], outgoing: [], total: 30, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }}
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
          total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false,
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

  it("renders the master share switch from data.sharePresence, when there is a friend", () => {
    render(
      <RosterView
        data={{ friends: [withPresence], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25, sharePresence: true, shareLocation: true }}
        {...actions}
      />,
    );
    expect(screen.getByRole("checkbox", { name: /tell friends when i come online/i })).toBeChecked();
  });

  // A user with only pending requests (no accepted friends yet) can still set their global
  // privacy preference ahead of the moment a request is accepted — the switch should not be
  // hidden just because `friends` is empty.
  it("renders the master switch with only incoming requests, no friends yet", () => {
    render(
      <RosterView
        data={{ friends: [], incoming: [entry(1, "IncomingOne")], outgoing: [], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }}
        {...actions}
      />,
    );
    expect(screen.getByRole("checkbox", { name: /tell friends when i come online/i })).toBeInTheDocument();
  });

  it("renders the master switch with only outgoing requests, no friends yet", () => {
    render(
      <RosterView
        data={{ friends: [], incoming: [], outgoing: [entry(3, "PendingOne")], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }}
        {...actions}
      />,
    );
    expect(screen.getByRole("checkbox", { name: /tell friends when i come online/i })).toBeInTheDocument();
  });

  it("does not render the master switch with a genuinely empty roster", () => {
    render(<RosterView data={{ friends: [], incoming: [], outgoing: [], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }} {...actions} />);
    expect(screen.queryByRole("checkbox", { name: /tell friends when i come online/i })).toBeNull();
  });

  it("shows per-friend presence toggles on friend rows, but not on incoming or outgoing rows", () => {
    render(
      <RosterView
        data={{
          friends: [withPresence], incoming: [entry(1, "IncomingOne")], outgoing: [entry(3, "PendingOne")],
          total: 1, page: 1, pageSize: 25, sharePresence: true, shareLocation: true,
        }}
        {...actions}
      />,
    );
    const friends = screen.getByRole("list", { name: /friends/i });
    expect(within(friends).getByRole("checkbox", { name: /tell them when i come online/i })).toBeInTheDocument();
    expect(within(friends).getByRole("checkbox", { name: /notify me/i })).toBeInTheDocument();

    const incoming = screen.getByRole("list", { name: /requests/i });
    expect(within(incoming).queryByRole("checkbox")).toBeNull();
    const outgoing = screen.getByRole("list", { name: /sent/i });
    expect(within(outgoing).queryByRole("checkbox")).toBeNull();
  });

  it("reports a presence change through onPresenceChange", async () => {
    const onPresenceChange = vi.fn();
    render(
      <RosterView
        data={{ friends: [withPresence], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25, sharePresence: true, shareLocation: true }}
        {...actions}
        onPresenceChange={onPresenceChange}
      />,
    );
    screen.getByRole("checkbox", { name: /notify me/i }).click();
    expect(onPresenceChange).toHaveBeenCalledWith(2, { notify: true });
  });

  it("reports a master switch change through onSharePresenceChange", () => {
    const onSharePresenceChange = vi.fn();
    render(
      <RosterView
        data={{ friends: [withPresence], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }}
        {...actions}
        onSharePresenceChange={onSharePresenceChange}
      />,
    );
    screen.getByRole("checkbox", { name: /tell friends when i come online/i }).click();
    expect(onSharePresenceChange).toHaveBeenCalledWith(true);
  });

  it("shows the location controls on friend rows only, not incoming or outgoing rows", () => {
    render(
      <RosterView
        data={{
          friends: [withLocation], incoming: [entry(1, "IncomingOne")], outgoing: [entry(3, "PendingOne")],
          total: 1, page: 1, pageSize: 25, sharePresence: true, shareLocation: true,
        }}
        {...actions}
      />,
    );
    const friends = screen.getByRole("list", { name: /friends/i });
    expect(within(friends).getByRole("checkbox", { name: /share my location/i })).toBeInTheDocument();
    expect(within(friends).getByText("Sharing with you")).toBeInTheDocument();

    const incoming = screen.getByRole("list", { name: /requests/i });
    expect(within(incoming).queryByRole("checkbox")).toBeNull();
    const outgoing = screen.getByRole("list", { name: /sent/i });
    expect(within(outgoing).queryByRole("checkbox")).toBeNull();
  });

  it("reports a location change through onLocationChange", () => {
    const onLocationChange = vi.fn();
    render(
      <RosterView
        data={{ friends: [withLocation], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25, sharePresence: true, shareLocation: true }}
        {...actions}
        onLocationChange={onLocationChange}
      />,
    );
    screen.getByRole("checkbox", { name: "Share my location" }).click();
    expect(onLocationChange).toHaveBeenCalledWith(2, false);
  });

  it("reports a master location switch change through onShareLocationChange", () => {
    const onShareLocationChange = vi.fn();
    render(
      <RosterView
        data={{ friends: [withLocation], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }}
        {...actions}
        onShareLocationChange={onShareLocationChange}
      />,
    );
    screen.getByRole("checkbox", { name: /share my location with friends/i }).click();
    expect(onShareLocationChange).toHaveBeenCalledWith(true);
  });
});

const { mockAccount, getFriends, acceptFriendRequest, patchFriendPresence, patchPreferences } = vi.hoisted(() => ({
  mockAccount: { value: null as unknown },
  getFriends: vi.fn(),
  acceptFriendRequest: vi.fn(),
  patchFriendPresence: vi.fn(),
  patchPreferences: vi.fn(),
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
    patchFriendPresence: (...a: unknown[]) => patchFriendPresence(...a),
    patchPreferences: (...a: unknown[]) => patchPreferences(...a),
  };
});

describe("Roster container", () => {
  function wrap(ui: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return { ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>), qc };
  }

  const feed = { friends: [], incoming: [entry(1, "IncomingOne")], outgoing: [], total: 0, page: 1, pageSize: 25, sharePresence: false, shareLocation: false };

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
          ? { friends: page1Friends, incoming: [], outgoing: [], total: 26, page: 1, pageSize: 25, sharePresence: false, shareLocation: false }
          : { friends: [entry(26, "Friend26")], incoming: [], outgoing: [], total: 26, page: 2, pageSize: 25, sharePresence: false, shareLocation: false },
      ),
    );
    const { qc } = wrap(<Roster />);

    const nextBtn = await screen.findByRole("button", { name: /next/i });
    nextBtn.click();
    await screen.findByRole("link", { name: "Friend26" });

    // Simulate the server-side effect of removing that last friend on page 2: total drops to
    // 25 (one full page), and page 2 now has no rows.
    qc.setQueryData(["friends", 2], { friends: [], incoming: [], outgoing: [], total: 25, page: 2, pageSize: 25, sharePresence: false, shareLocation: false });

    // The roster clamps back to page 1 (already cached) rather than rendering an empty
    // section with no way back.
    await screen.findByRole("link", { name: "Friend1" });
    expect(screen.queryByText(/no friends yet/i)).toBeNull();
  });

  // The master switch no longer controls visibility — the map lists everyone online
  // regardless — so its announcement must describe what it actually does (notify friends),
  // never "sharing your status", which is the same lie the visible copy was fixed to drop.
  it("announces what the master switch actually does — notification, not visibility", async () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    getFriends.mockResolvedValue({
      friends: [withPresence], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25, sharePresence: false, shareLocation: false,
    });
    patchPreferences.mockResolvedValue({});
    wrap(<Roster />);

    const masterSwitch = await screen.findByRole("checkbox", { name: /tell friends when i come online/i });
    masterSwitch.click();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/friends will be told when you come online/i));
    expect(screen.queryByText(/sharing your status/i)).toBeNull();
  });

  it("does not announce success on a failed presence write, and surfaces the mapped error text", async () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    getFriends.mockResolvedValue({
      friends: [withPresence], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25, sharePresence: true, shareLocation: true,
    });
    const { ApiError } = await import("@/lib/api");
    patchFriendPresence.mockRejectedValue(new ApiError(404, "not_found"));
    wrap(<Roster />);

    const notifyBox = await screen.findByRole("checkbox", { name: /notify me/i });
    notifyBox.click();

    await waitFor(() => expect(screen.getByText(/not found|couldn't|went wrong/i)).toBeInTheDocument());
    expect(screen.queryByText(/presence updated/i)).toBeNull();
  });

  it("does not announce success on a failed location write, and surfaces the mapped error text", async () => {
    mockAccount.value = {
      kind: "verified",
      link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
    };
    getFriends.mockResolvedValue({
      friends: [withLocation], incoming: [], outgoing: [], total: 1, page: 1, pageSize: 25, sharePresence: true, shareLocation: true,
    });
    const { ApiError } = await import("@/lib/api");
    patchFriendPresence.mockRejectedValue(new ApiError(404, "not_found"));
    wrap(<Roster />);

    const locationBox = await screen.findByRole("checkbox", { name: "Share my location" });
    locationBox.click();

    await waitFor(() => expect(screen.getByText(/not found|couldn't|went wrong/i)).toBeInTheDocument());
    expect(screen.queryByText(/location updated/i)).toBeNull();
  });
});
