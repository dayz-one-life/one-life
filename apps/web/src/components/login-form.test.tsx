import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  test("renders only configured providers; discord gets blurple", () => {
    render(<LoginForm providers={["discord", "google"]} magicLink={false} onMagicLink={async () => {}} onSocial={() => {}} />);
    expect(screen.getByRole("button", { name: "Continue with discord" }).className).toContain("bg-discord");
    expect(screen.getByRole("button", { name: "Continue with google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with github" })).not.toBeInTheDocument();
  });

  test("social click delegates the provider", () => {
    const onSocial = vi.fn();
    render(<LoginForm providers={["discord"]} magicLink={false} onMagicLink={async () => {}} onSocial={onSocial} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with discord" }));
    expect(onSocial).toHaveBeenCalledWith("discord");
  });

  test("magic link submits and shows the sent state as a role=status announcement", async () => {
    const onMagicLink = vi.fn(async () => {});
    render(<LoginForm providers={[]} magicLink onMagicLink={onMagicLink} onSocial={() => {}} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Check your email for a sign-in link."));
    expect(onMagicLink).toHaveBeenCalledWith("a@b.co");
  });

  test("magic link success moves focus to the status confirmation", async () => {
    const onMagicLink = vi.fn(async () => {});
    render(<LoginForm providers={[]} magicLink onMagicLink={onMagicLink} onSocial={() => {}} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveFocus());
  });

  test("magic link failure shows the alert", async () => {
    render(
      <LoginForm providers={[]} magicLink onMagicLink={async () => { throw new Error("x"); }} onSocial={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not send the link. Try again."));
  });

  test("email error ties to the input via aria-describedby and aria-invalid", async () => {
    render(
      <LoginForm providers={[]} magicLink onMagicLink={async () => { throw new Error("x"); }} onSocial={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAccessibleDescription("Could not send the link. Try again.");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  test("nothing configured: honest notice", () => {
    render(<LoginForm providers={[]} magicLink={false} onMagicLink={async () => {}} onSocial={() => {}} />);
    expect(screen.getByText("No sign-in methods are currently available.")).toBeInTheDocument();
  });

  test("email input carries a visible focus ring on the dark surface", () => {
    render(<LoginForm providers={[]} magicLink onMagicLink={async () => {}} onSocial={() => {}} />);
    expect(screen.getByLabelText("Email").className).toContain("focus-visible:outline-red");
  });
});
