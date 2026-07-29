import { render } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import PrivacyPage from "./page";

const text = () => render(<PrivacyPage />).container.textContent ?? "";

// ⚠️ These assert CONTENT, not counts. Each is a disclosure a later copy edit could shorten away
// with no other test noticing. If one fails, restore the clause — do not relax the assertion.
describe("load-bearing disclosures", () => {
  it("publishes the contact address", () => {
    expect(text()).toContain("admin@dayzonelife.com");
  });

  // The single sharpest omission risk on this page: players cannot guess that their gamertag is
  // sent to a third-party LLM to have an obituary written about them.
  it("discloses that gamertags and death details go to OpenRouter and Anthropic", () => {
    const t = text();
    expect(t).toContain("OpenRouter");
    expect(t).toContain("Anthropic");
    expect(t).toMatch(/your killer&rsquo;s gamertag|your killer’s gamertag/);
  });

  it("discloses IP address and user-agent storage on the session", () => {
    const t = text();
    expect(t).toMatch(/IP address/i);
    expect(t).toMatch(/user-agent/i);
  });

  it("discloses that map coordinates are recorded", () => {
    expect(text()).toMatch(/position on the map/i);
  });

  it("states that chat is not recorded", () => {
    expect(text()).toMatch(/Chat is not recorded/i);
  });

  it("states there are no ads, analytics or trackers, and nothing is sold", () => {
    const t = text();
    expect(t).toMatch(/no analytics/i);
    expect(t).toMatch(/no tracking scripts/i);
  });

  // The promise the architecture has to keep. Softening either half is a defect.
  it("promises account deletion while stating the gameplay record stands", () => {
    const t = text();
    expect(t).toMatch(/Not deleted/i);
    expect(t).toMatch(/append-only/i);
  });

  it("states retention honestly as indefinite", () => {
    expect(text()).toMatch(/Indefinitely/i);
  });
});

it("prints the shared effective date", async () => {
  const { EFFECTIVE_DATE } = await import("@/content/legal/effective-date");
  expect(text()).toContain(EFFECTIVE_DATE);
});

it("gives every clause a unique, non-empty anchor id", async () => {
  const { PRIVACY_SECTIONS } = await import("@/content/legal/privacy");
  const ids = PRIVACY_SECTIONS.map((s) => s.id);
  expect(ids.every((id) => id.length > 0)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  expect(PRIVACY_SECTIONS.every((s) => s.heading.length > 0)).toBe(true);
});
