import { render, screen } from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ getAuthMethods: vi.fn() }));
vi.mock("@/components/discord-redirect", () => ({ DiscordRedirect: () => <div>discord</div> }));
vi.mock("@/components/login-panel", () => ({ LoginPanel: () => <div>panel</div> }));

import { getAuthMethods } from "@/lib/api";
import LoginPage from "./page";

const DISCORD_ONLY = { providers: ["discord"], magicLink: false };

beforeEach(() => {
  vi.mocked(getAuthMethods).mockResolvedValue(DISCORD_ONLY as never);
});

it("tells you what signing in commits you to, and links both documents", async () => {
  render(await LoginPage());
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
});

// ⚠️ The consent line sits outside the three-way state switch on purpose. A line that renders
// only in the happy path is one that half the users never see.
it("shows the consent line even when the API is down and no method renders", async () => {
  vi.mocked(getAuthMethods).mockRejectedValue(new Error("down"));
  render(await LoginPage());
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Terms" })).toBeInTheDocument();
});
