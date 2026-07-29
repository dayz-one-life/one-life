import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { isDiscordOnly } from "./discord-only";

describe("isDiscordOnly", () => {
  it("true only for exactly [discord] with magic link off", () => {
    expect(isDiscordOnly({ providers: ["discord"], magicLink: false })).toBe(true);
    expect(isDiscordOnly({ providers: ["discord"], magicLink: true })).toBe(false);
    expect(isDiscordOnly({ providers: ["discord", "google"], magicLink: false })).toBe(false);
    expect(isDiscordOnly({ providers: [], magicLink: false })).toBe(false);
    expect(isDiscordOnly(null)).toBe(false); // failed providers fetch → never auto-redirect
  });
});

// The regression guard for the v0.57.0 outage. `login/page.tsx` is a server component that CALLS
// this predicate, so the module it lives in must stay server-safe. When the function sat in the
// "use client" `discord-redirect.tsx`, every /login request threw
// "Attempted to call isDiscordOnly() from the server" and returned 500 — with the entire suite
// green, because vitest/jsdom does not enforce the RSC boundary and tsc cannot see it.
// A behavioural test cannot catch this; reading the directive can.
describe("RSC boundary", () => {
  it("the module defining isDiscordOnly carries no \"use client\" directive", () => {
    const src = readFileSync(join(__dirname, "discord-only.ts"), "utf8");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
  });

  it("login/page.tsx imports the predicate from the server-safe module, not the client component", () => {
    const page = readFileSync(
      join(__dirname, "..", "app", "(site)", "(boxed)", "login", "page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/import\s*\{\s*isDiscordOnly\s*\}\s*from\s*["']@\/lib\/discord-only["']/);
    // The component may still be imported from the client module — rendering one is legal.
    expect(page).not.toMatch(/import\s*\{[^}]*isDiscordOnly[^}]*\}\s*from\s*["']@\/components\/discord-redirect["']/);
  });
});
