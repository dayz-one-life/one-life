import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { MobileControls } from "./mobile-controls";
import { useControls, useControlsActions } from "./use-controls";

vi.mock("./use-controls", () => ({ useControls: vi.fn(), useControlsActions: vi.fn() }));

// The mobile sheet is the surface where this matters most. A phone or a shared tablet is
// where two people actually use the same browser, and the browser's PushSubscription object
// survives sign-out untouched: if the server row is not deleted while the outgoing session is
// still valid, the next person to sign in keeps receiving the previous user's push — obituary
// headlines carrying their gamertag included.
//
// signOutAndTeardownPush is the one path that deletes the row before ending the session. The
// desktop rail has had a test for this since it shipped; the sheet had none, and a rewrite to
// a bare signOut() left the entire web suite green.
const signOutAndTeardownPush = vi.fn(async () => {});
const bareSignOut = vi.fn(async () => {});
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: () => signOutAndTeardownPush() }));
vi.mock("@/lib/auth-client", () => ({ signOut: () => bareSignOut() }));

const mut = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null });
const base = {
  name: "Boots", provider: "discord", balance: 3, servers: [], standing: [],
  notifications: [], unreadCount: 0, hasMore: false, loadMore: vi.fn(), loadingMore: false,
};
const verified = {
  ...base,
  status: {
    kind: "verified",
    link: { id: 1, gamertag: "BootsColdwater", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  (useControlsActions as Mock).mockReturnValue({
    claim: mut(), cancel: mut(), send: mut(), refer: mut(), redeem: mut(), markRead: mut(),
  });
});

function openSheet(): void {
  render(<MobileControls />);
  // The pill is the only thing rendered until the sheet is opened.
  fireEvent.click(screen.getByRole("button", { name: /player controls/i }));
}

describe("MobileControls", () => {
  test("renders nothing while auth is still resolving", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "loading" } });
    const { container } = render(<MobileControls />);
    expect(container).toBeEmptyDOMElement();
  });

  test("signed out: a sign-in pill, no sheet", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "signedOut" } });
    render(<MobileControls />);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  test("sign out tears down push before ending the session", () => {
    (useControls as Mock).mockReturnValue(verified);
    openSheet();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOutAndTeardownPush).toHaveBeenCalledOnce();
    // Belt and braces: calling signOut() directly is the exact regression this guards. It
    // would end the session with the push row still pointing at this user.
    expect(bareSignOut).not.toHaveBeenCalled();
  });

  // The rail only shows the sign-out footer when signed in; the sheet must match, including
  // for users who have not linked a gamertag yet and so see none of the verified panels.
  test("an unlinked user can still sign out", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "unlinked" } });
    openSheet();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutAndTeardownPush).toHaveBeenCalledOnce();
  });
});
