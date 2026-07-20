import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { ControlsRail } from "./rail";
import { useControls, useControlsActions } from "./use-controls";

vi.mock("./use-controls", () => ({ useControls: vi.fn(), useControlsActions: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ signOut: vi.fn(async () => {}) }));
// Sign-out must go through the shared helper, which tears the push subscription down before
// the session dies. A bare signOut() here leaves a shared browser delivering this user's
// notifications to whoever signs in next.
const signOutAndTeardownPush = vi.fn(async () => {});
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: () => signOutAndTeardownPush() }));

const mut = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null });
const base = { name: "Boots", provider: "discord", balance: 3, servers: [], standing: [], notifications: [], unreadCount: 0 };

beforeEach(() => {
  (useControlsActions as Mock).mockReturnValue({ claim: mut(), cancel: mut(), send: mut(), refer: mut(), redeem: mut(), markRead: mut() });
});

describe("ControlsRail", () => {
  test("signed out: CTA panel only", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "signedOut" } });
    render(<ControlsRail />);
    expect(screen.getByText("Get in the paper.")).toBeInTheDocument();
    expect(screen.queryByText("Unban tokens")).not.toBeInTheDocument();
  });

  test("unlinked: identity + link panel + sign out (no profile link)", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "unlinked" } });
    render(<ControlsRail />);
    expect(screen.getByText("Via discord · No gamertag")).toBeInTheDocument();
    expect(screen.getByText("Link your gamertag.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Your profile →" })).not.toBeInTheDocument();
  });

  test("pending: prove-it panel + sign out (no profile link)", () => {
    (useControls as Mock).mockReturnValue({
      ...base,
      status: { kind: "pending", link: { id: 1, gamertag: "Boots", status: "pending", verifiedAt: null, challenge: { sequence: ["facepalm", "salute", "clap"], progressIndex: 0, expiresAt: "2027-01-01T00:00:00Z", expired: false } } },
    });
    render(<ControlsRail />);
    expect(screen.getByText("Prove it's you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Your profile →" })).not.toBeInTheDocument();
  });

  test("verified: identity + tokens + servers header + footer links", () => {
    (useControls as Mock).mockReturnValue({
      ...base,
      status: { kind: "verified", link: { id: 1, gamertag: "BootsColdwater", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null } },
      servers: [{ id: 1, nitradoServiceId: 1, name: "s", map: "chernarusplus", slug: "chernarus", active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z" }],
    });
    render(<ControlsRail />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Unban tokens")).toBeInTheDocument();
    expect(screen.getByText("Your servers")).toBeInTheDocument();
    expect(screen.getByText("No life")).toBeInTheDocument(); // never-played server renders idle
    expect(screen.getByRole("link", { name: "Your profile →" })).toHaveAttribute("href", "/players/bootscoldwater");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  test("sign out tears down push before ending the session", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "unlinked" } });
    render(<ControlsRail />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutAndTeardownPush).toHaveBeenCalledOnce();
  });

  test("verified: opening notifications reveals the list and marks them read", () => {
    const actions = { claim: mut(), cancel: mut(), send: mut(), refer: mut(), redeem: mut(), markRead: mut() };
    (useControlsActions as Mock).mockReturnValue(actions);
    (useControls as Mock).mockReturnValue({
      ...base,
      status: { kind: "verified", link: { id: 1, gamertag: "BootsColdwater", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null } },
      notifications: [
        { id: 7, kind: "ban_applied", title: "You died on a qualified life", body: "24 hours.", href: "/players/bootscoldwater", createdAt: "2026-07-19T11:30:00Z", readAt: null },
      ],
      unreadCount: 1,
    });
    render(<ControlsRail />);

    // Collapsed: the badge shows, the item does not.
    expect(screen.getByTestId("unread-badge")).toHaveTextContent("1");
    expect(screen.queryByText("You died on a qualified life")).not.toBeInTheDocument();
    expect(actions.markRead.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(screen.getByRole("link", { name: /You died on a qualified life/ })).toHaveAttribute("href", "/players/bootscoldwater");
    expect(actions.markRead.mutate).toHaveBeenCalledTimes(1);
  });

  test("loading: skeleton, nothing interactive", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "loading" } });
    const { container } = render(<ControlsRail />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
