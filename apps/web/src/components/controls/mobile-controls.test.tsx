import { fireEvent, render, screen, within } from "@testing-library/react";
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
    claim: mut(), cancel: mut(), send: mut(), refer: mut(), redeem: mut(),
  });
});

function openSheet() {
  const result = render(<MobileControls />);
  // The pill is the only thing rendered until the sheet is opened.
  fireEvent.click(screen.getByRole("button", { name: /player controls/i }));
  return result;
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

  test("verified: standing unresolved shows a loading placeholder, not fabricated idle server rows/dots", () => {
    (useControls as Mock).mockReturnValue({
      ...verified,
      servers: [{ id: 1, nitradoServiceId: 1, name: "s", map: "chernarusplus", slug: "chernarus", active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z" }],
      standingLoading: true,
    });
    const { container } = openSheet();
    // Must NOT assert "idle" from an unresolved player query, in the sheet row or the pill dots.
    expect(screen.queryByText("No life")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  // live-data honesty §5 fix round 1: the pill's status line must not assert "No active life"
  // (a factual claim) while standing is still unresolved — it falls through pillStatus's cards
  // empty-shape branch exactly like a genuinely-resolved empty board does.
  test("verified: standing unresolved shows the pill's neutral checking line, not 'No active life'", () => {
    (useControls as Mock).mockReturnValue({ ...verified, standingLoading: true });
    render(<MobileControls />);
    expect(screen.getByText("Checking your servers…")).toBeInTheDocument();
    expect(screen.queryByText("No active life")).not.toBeInTheDocument();
  });

  test("verified: standing genuinely resolved empty still shows 'No active life' on the pill", () => {
    (useControls as Mock).mockReturnValue({ ...verified, standingLoading: false });
    render(<MobileControls />);
    expect(screen.getByText("No active life")).toBeInTheDocument();
  });

  // live-data honesty §5 fix round 1: mirrors the rail — the sheet's tokens panel and any
  // banned-server CTA must not fabricate a "0" balance / "No unban tokens" while unresolved.
  test("verified: balance unresolved shows a checking affordance, not a fabricated 0 balance or no-tokens CTA", () => {
    (useControls as Mock).mockReturnValue({
      ...verified,
      balance: null,
      balanceLoading: true,
      servers: [{ id: 1, nitradoServiceId: 1, name: "s", map: "chernarusplus", slug: "chernarus", active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z" }],
      standing: [{ serverId: 1, map: "chernarusplus", slug: "chernarus", state: "banned", character: null, alive: null, ban: { banId: 9, bannedAt: "2026-07-16T09:47:00Z", expiresAt: null, liftPending: false, triggeringLifeNumber: 1 } }],
    });
    openSheet();
    expect(screen.queryByText("No unban tokens")).not.toBeInTheDocument();
    expect(screen.getAllByText(/checking your (balance|tokens)/i).length).toBeGreaterThan(0);
    // fix round 2: the pill's own "N tok" chip (`pill.tsx`) must not fabricate "0 tok" either —
    // it sits inches from TokensPanel's correct "Checking your tokens…" and used to contradict it.
    const pill = screen.getByRole("button", { name: /player controls/i });
    expect(within(pill).queryByText("0")).not.toBeInTheDocument();
    expect(within(pill).getByText(/checking your tokens/i)).toBeInTheDocument();
  });
});
