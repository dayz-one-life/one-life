import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.mock("@/lib/auth-client", () => ({ signIn: { magicLink: vi.fn(), social: vi.fn() } }));

import { LoginPanel } from "./login-panel";

describe("LoginPanel", () => {
  it("signed out: renders the sign-in form", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<LoginPanel providers={["discord"]} magicLink={false} />);
    expect(screen.getByRole("button", { name: /discord/i })).toBeInTheDocument();
  });

  it("signed in: says so instead of offering sign-in again", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Steve" } });
    render(<LoginPanel providers={["discord"]} magicLink={false} />);
    expect(screen.getByText(/already signed in/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /discord/i })).toBeNull();
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
  });

  it("loading: renders the form (no signed-in flash for anonymous visitors)", () => {
    mockStatus.mockReturnValue({ kind: "loading" });
    render(<LoginPanel providers={["discord"]} magicLink={false} />);
    expect(screen.getByRole("button", { name: /discord/i })).toBeInTheDocument();
  });
});
