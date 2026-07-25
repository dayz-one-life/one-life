import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: vi.fn() }));

import { useAccountStatus } from "@/lib/use-account-status";
import { AccountAffordance } from "./account-affordance";

const status = (kind: string, gamertag?: string) =>
  vi.mocked(useAccountStatus).mockReturnValue((gamertag ? { kind, link: { gamertag } } : { kind }) as never);

describe("AccountAffordance", () => {
  beforeEach(() => vi.clearAllMocks());

  test("verified: links to the account page", () => {
    status("verified", "xSgt Hartman");
    render(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i })).toHaveAttribute("href", "/you");
  });

  // Sign-out lives on /you, so an unlinked user must be able to reach it too.
  test("signed in but unlinked still reaches the account page", () => {
    status("unlinked");
    render(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i })).toHaveAttribute("href", "/you");
  });

  test("pending reaches it as well", () => {
    status("pending", "Ghost");
    render(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i })).toHaveAttribute("href", "/you");
  });

  test("signed out: a sign-in chip", () => {
    status("signedOut");
    render(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  test("renders nothing while identity resolves — never a flash of the wrong state", () => {
    status("loading");
    const { container } = render(<AccountAffordance />);
    expect(container).toBeEmptyDOMElement();
  });

  // The old MobileAccount trigger was xl:hidden because the rail covered desktop. With the rail
  // gone this is the only account surface at any width, so it must never be width-gated.
  test("is not hidden at any breakpoint", () => {
    status("verified", "Ghost");
    render(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i }).className).not.toMatch(/hidden|xl:hidden/);
  });
});
