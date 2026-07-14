import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "./login-form";

const ALL = ["discord", "google", "github"];

describe("LoginForm", () => {
  it("calls onMagicLink with the entered email and shows confirmation", async () => {
    const onMagicLink = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm providers={ALL} magicLink onMagicLink={onMagicLink} onSocial={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: /magic link/i }));
    expect(onMagicLink).toHaveBeenCalledWith("a@b.com");
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });

  it("calls onSocial with the provider when a social button is clicked", async () => {
    const onSocial = vi.fn();
    render(<LoginForm providers={ALL} magicLink onMagicLink={async () => {}} onSocial={onSocial} />);
    await userEvent.click(screen.getByRole("button", { name: /discord/i }));
    expect(onSocial).toHaveBeenCalledWith("discord");
  });

  it("shows only the configured social providers", () => {
    render(<LoginForm providers={["discord"]} magicLink onMagicLink={async () => {}} onSocial={() => {}} />);
    expect(screen.getByRole("button", { name: /discord/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /github/i })).not.toBeInTheDocument();
  });

  it("hides the email form when magic link is disabled", () => {
    render(<LoginForm providers={["discord"]} magicLink={false} onMagicLink={async () => {}} onSocial={() => {}} />);
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /magic link/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discord/i })).toBeInTheDocument();
  });

  it("tells the user when no methods are available", () => {
    render(<LoginForm providers={[]} magicLink={false} onMagicLink={async () => {}} onSocial={() => {}} />);
    expect(screen.getByText(/no sign-in methods/i)).toBeInTheDocument();
  });
});
