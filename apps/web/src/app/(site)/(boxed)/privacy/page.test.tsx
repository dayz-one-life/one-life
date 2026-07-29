import { render } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import PrivacyPage from "./page";

const text = () => render(<PrivacyPage />).container.textContent ?? "";
const section = (id: string) => {
  const container = render(<PrivacyPage />).container;
  return container.querySelector(`#${id}`)?.textContent ?? "";
};

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
    // The one verified-true promise in this section — currently the easiest sentence here to
    // trim away silently. Pin it so a later edit can't drop it without this test noticing.
    expect(t).toMatch(/Your account, email and IP address are not sent/i);
  });

  it("discloses that recent obituary prose is sent as style context and may name other players", () => {
    const t = section("who-else");
    expect(t).toMatch(/recently published obituaries as style context/i);
    expect(t).toMatch(/other players&rsquo;? gamertags|other players’ gamertags/i);
  });

  it("discloses IP address and user-agent storage on the session", () => {
    const t = text();
    expect(t).toMatch(/IP address/i);
    expect(t).toMatch(/user-agent/i);
  });

  it("discloses that map coordinates are recorded", () => {
    expect(text()).toMatch(/position on the map/i);
  });

  it("states that chat is not parsed, stored, or published", () => {
    const t = text();
    expect(t).toMatch(/Nothing you say in chat is parsed, stored as data, or published/i);
    expect(t).toMatch(/no handling for chat/i);
  });

  it("states there are no ads, analytics or trackers, and nothing is sold", () => {
    const t = text();
    expect(t).toMatch(/no analytics/i);
    expect(t).toMatch(/no tracking scripts/i);
    // The "nothing is sold" half of this test's own name — until now unasserted, so a later trim
    // could have dropped this sentence with nothing here catching it.
    expect(t).toMatch(/sold, rented, or handed to a data broker/i);
  });

  // C1: this site sets a second first-party cookie (apps/web/src/lib/map-resolution.ts,
  // SESSION_MAP_COOKIE) beyond the session cookie. Scoped to the #cookies section itself (not
  // the whole page) so this fails if §8 alone regresses — §3 also mentions the map cookie, so an
  // assertion against the whole page's text would stay green even if §8 reverted to "One cookie:
  // the session cookie." This is exactly where the false claim this test guards against lived.
  it("names both cookies this site sets, in the cookies section itself", () => {
    const t = section("cookies");
    expect(t).toMatch(/two cookies/i);
    expect(t).toMatch(/keeps you signed in/i);
    expect(t).toMatch(/which map you were last looking at/i);
  });

  it("states there are no third-party cookies and nothing to consent to", () => {
    const t = section("cookies");
    expect(t).toMatch(/no third-party cookies/i);
    expect(t).toMatch(/nothing to consent to/i);
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
