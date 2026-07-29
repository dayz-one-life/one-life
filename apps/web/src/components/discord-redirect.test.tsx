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
  it("fires the discord social sign-in on mount and shows the fallback link", async () => {
    render(<DiscordRedirect />);
    expect(social).toHaveBeenCalledWith({ provider: "discord", callbackURL: "/welcome" });
    // The live region is filled inside the effect (so it actually announces — an aria-live region
    // must be empty at registration for a later change to be noticed), so assert via findByText
    // rather than assuming it's present synchronously at first render.
    expect(await screen.findByText(/Redirecting to Discord/i)).toBeInTheDocument();
    const fallback = screen.getByRole("button", { name: "Continue to Discord →" });
    fallback.click();
    expect(social).toHaveBeenCalledTimes(2);
  });
});
