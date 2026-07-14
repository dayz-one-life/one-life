import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  it("calls onMagicLink with the entered email and shows confirmation", async () => {
    const onMagicLink = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm onMagicLink={onMagicLink} onSocial={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: /magic link/i }));
    expect(onMagicLink).toHaveBeenCalledWith("a@b.com");
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });

  it("calls onSocial with the provider when a social button is clicked", async () => {
    const onSocial = vi.fn();
    render(<LoginForm onMagicLink={async () => {}} onSocial={onSocial} />);
    await userEvent.click(screen.getByRole("button", { name: /discord/i }));
    expect(onSocial).toHaveBeenCalledWith("discord");
  });
});
