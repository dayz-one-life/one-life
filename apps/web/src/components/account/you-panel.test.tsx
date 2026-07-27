import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const noopMut = { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null };
vi.mock("@/components/account/use-controls", () => ({
  useControls: vi.fn(),
  useControlsActions: () => ({
    claim: noopMut,
    cancel: noopMut,
    send: noopMut,
    refer: noopMut,
    redeem: noopMut,
  }),
}));
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: vi.fn() }));
// AvatarPanel owns its own query/mutations and is tested in isolation
// (avatar-panel.test.tsx) — a stub here avoids needing a QueryClientProvider for every
// YouPanel test.
vi.mock("@/components/account/avatar-panel", () => ({ AvatarPanel: () => null }));

import { useControls } from "@/components/account/use-controls";
import { YouPanel } from "./you-panel";

const controls = (over: Record<string, unknown>) =>
  vi.mocked(useControls).mockReturnValue({
    status: { kind: "signedOut" },
    name: null,
    provider: null,
    balance: null,
    servers: [],
    standing: [],
    standingLoading: false,
    balanceLoading: false,
    ...over,
  } as never);

describe("YouPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  test("signed out: points at sign-in rather than rendering a blank page", () => {
    controls({ status: { kind: "signedOut" } });
    render(<YouPanel />);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  test("loading renders a busy placeholder, not a signed-out state", () => {
    controls({ status: { kind: "loading" } });
    const { container } = render(<YouPanel />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });

  test("signed in: always offers sign-out, even before a gamertag is linked", () => {
    controls({ status: { kind: "unlinked" }, name: "Steve" });
    render(<YouPanel />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  test("verified: shows the profile link", () => {
    controls({ status: { kind: "verified", link: { gamertag: "xSgt Hartman" } }, balance: 2 });
    render(<YouPanel />);
    expect(screen.getByRole("link", { name: /your profile/i })).toHaveAttribute(
      "href",
      "/players/xsgt-hartman",
    );
  });

  test("unverified has no profile link — there is no dossier to point at yet", () => {
    controls({ status: { kind: "pending", link: { gamertag: "Ghost" } } });
    render(<YouPanel />);
    expect(screen.queryByRole("link", { name: /your profile/i })).toBeNull();
  });

  // The claim ladder lives on Home. /you must never be the only route to a gamertag.
  test("unlinked: carries no claim form, and points at Home instead", () => {
    controls({ status: { kind: "unlinked" }, name: "Steve" });
    render(<YouPanel />);
    expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
    expect(screen.getByRole("link", { name: /home page/i })).toHaveAttribute("href", "/");
  });

  // Home-is-the-app spec §3: tokens moved back to Home; /you is the avatar-menu seed and must
  // not grow app surface back. The claim wording stays absent (nothing left to claim); the
  // pointer home now names servers and tokens instead.
  test("verified: no tokens panel — a pointer home to servers and tokens instead", () => {
    controls({ status: { kind: "verified", link: { gamertag: "Ghost" } }, balance: 5 });
    render(<YouPanel />);
    expect(screen.queryByText(/unban tokens/i)).toBeNull();
    expect(screen.queryByText(/claim/i)).toBeNull();
    expect(screen.getByText(/your servers and tokens live on the/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /home page/i })).toHaveAttribute("href", "/");
  });
});
