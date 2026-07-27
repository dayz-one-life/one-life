import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: vi.fn() }));
const getAvatar = vi.fn();
vi.mock("@/lib/api", () => ({ getAvatar: (...a: unknown[]) => getAvatar(...a) }));

import { useAccountStatus } from "@/lib/use-account-status";
import { AccountAffordance } from "./account-affordance";

const status = (kind: string, gamertag?: string) =>
  vi.mocked(useAccountStatus).mockReturnValue((gamertag ? { kind, link: { gamertag } } : { kind }) as never);

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("AccountAffordance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAvatar.mockResolvedValue({ hash: null });
  });

  test("verified: links to the account page", () => {
    status("verified", "xSgt Hartman");
    wrap(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i })).toHaveAttribute("href", "/you");
  });

  // Sign-out lives on /you, so an unlinked user must be able to reach it too.
  test("signed in but unlinked still reaches the account page", () => {
    status("unlinked");
    wrap(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i })).toHaveAttribute("href", "/you");
  });

  test("pending reaches it as well", () => {
    status("pending", "Ghost");
    wrap(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i })).toHaveAttribute("href", "/you");
  });

  test("signed out: a sign-in chip", () => {
    status("signedOut");
    wrap(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  test("renders nothing while identity resolves — never a flash of the wrong state", () => {
    status("loading");
    const { container } = wrap(<AccountAffordance />);
    expect(container).toBeEmptyDOMElement();
  });

  // The old MobileAccount trigger was xl:hidden because the rail covered desktop. With the rail
  // gone this is the only account surface at any width, so it must never be width-gated.
  test("is not hidden at any breakpoint", () => {
    status("verified", "Ghost");
    wrap(<AccountAffordance />);
    // `overflow-hidden` (needed to clip the avatar disc's img to the circle) is not this rule's
    // concern — only a bare/`xl:`-prefixed display "hidden" utility TOKEN is (a substring match
    // would false-positive on `overflow-hidden`).
    const classes = screen.getByRole("link", { name: /account/i }).className.split(/\s+/);
    expect(classes).not.toContain("hidden");
    expect(classes).not.toContain("xl:hidden");
  });

  test("renders the initial disc, not blanked, while the avatar query is loading", () => {
    status("verified", "Ghost");
    getAvatar.mockReturnValue(new Promise(() => {})); // never resolves during this test
    wrap(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i })).toBeInTheDocument();
    expect(screen.getByText("G")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  test("renders an avatar disc once the query resolves a hash", async () => {
    status("verified", "Ghost");
    getAvatar.mockResolvedValue({ hash: "abc123" });
    const { container } = wrap(<AccountAffordance />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/avatars/abc123.webp");
  });

  test("falls back to the initial disc when the avatar query resolves no hash", async () => {
    status("verified", "Ghost");
    getAvatar.mockResolvedValue({ hash: null });
    wrap(<AccountAffordance />);
    expect(await screen.findByText("G")).toBeInTheDocument();
  });

  test("signed-out visitors never query the avatar", () => {
    status("signedOut");
    wrap(<AccountAffordance />);
    expect(getAvatar).not.toHaveBeenCalled();
  });
});
