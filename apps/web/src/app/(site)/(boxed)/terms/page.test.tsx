import { render } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import TermsPage from "./page";

const text = () => render(<TermsPage />).container.textContent ?? "";

// ⚠️ These assert CONTENT, not counts. Each one is a disclosure or a limitation that a later
// copy edit could shorten away without any other test noticing. If one of these fails, the fix
// is to restore the clause — not to relax the assertion.
describe("load-bearing clauses", () => {
  it("publishes the contact address", () => {
    expect(text()).toContain("admin@dayzonelife.com");
  });

  it("disclaims affiliation with the game and platform holders", () => {
    const t = text();
    for (const party of ["Bohemia Interactive", "Microsoft", "Xbox", "Nitrado"]) {
      expect(t).toContain(party);
    }
    expect(t).toMatch(/not affiliated with/i);
  });

  it("states that unban tokens have no cash value and are not owed back", () => {
    const t = text();
    expect(t).toMatch(/no cash value/i);
    expect(t).toMatch(/cannot be bought/i);
  });

  it("states that obituaries are machine-written and not statements of fact about the player", () => {
    const t = text();
    expect(t).toMatch(/written by a machine/i);
    expect(t).toMatch(/not statements of fact about you/i);
  });

  it("names Arizona as the governing law", () => {
    expect(text()).toMatch(/State of Arizona/);
  });

  it("distinguishes the mechanical 24-hour ban from a discretionary admin ban", () => {
    const t = text();
    expect(t).toMatch(/24-hour ban is mechanical/i);
    expect(t).toMatch(/An admin ban is a decision/i);
  });
});

it("prints the shared effective date", async () => {
  const { EFFECTIVE_DATE } = await import("@/content/legal/effective-date");
  expect(text()).toContain(EFFECTIVE_DATE);
});

it("gives every clause a unique, non-empty anchor id", async () => {
  const { TERMS_SECTIONS } = await import("@/content/legal/terms");
  const ids = TERMS_SECTIONS.map((s) => s.id);
  expect(ids.every((id) => id.length > 0)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  expect(TERMS_SECTIONS.every((s) => s.heading.length > 0)).toBe(true);
});
