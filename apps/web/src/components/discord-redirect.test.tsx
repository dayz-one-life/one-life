import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DiscordRedirect, isDiscordOnly } from "./discord-redirect";

const social = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth-client", () => ({ signIn: { social: (...a: unknown[]) => social(...a) } }));

describe("isDiscordOnly", () => {
  it("true only for exactly [discord] with magic link off", () => {
    expect(isDiscordOnly({ providers: ["discord"], magicLink: false })).toBe(true);
    expect(isDiscordOnly({ providers: ["discord"], magicLink: true })).toBe(false);
    expect(isDiscordOnly({ providers: ["discord", "google"], magicLink: false })).toBe(false);
    expect(isDiscordOnly({ providers: [], magicLink: false })).toBe(false);
    expect(isDiscordOnly(null)).toBe(false); // failed providers fetch → never auto-redirect
  });
});

describe("DiscordRedirect", () => {
  it("fires the discord social sign-in on mount and shows the fallback link", () => {
    render(<DiscordRedirect />);
    expect(social).toHaveBeenCalledWith({ provider: "discord", callbackURL: "/welcome" });
    expect(screen.getByText(/Redirecting to Discord/i)).toBeInTheDocument();
    const fallback = screen.getByRole("button", { name: "Continue to Discord →" });
    fallback.click();
    expect(social).toHaveBeenCalledTimes(2);
  });
});
