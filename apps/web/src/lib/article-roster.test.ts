import { describe, it, expect } from "vitest";
import { obituaryRoster } from "./article-roster";

describe("obituaryRoster", () => {
  it("includes the subject and the killer", () => {
    expect(obituaryRoster({ gamertag: "Hartman", killerGamertag: "Pyle" })).toEqual(["Hartman", "Pyle"]);
  });
  it("drops a null killer", () => {
    expect(obituaryRoster({ gamertag: "Hartman", killerGamertag: null })).toEqual(["Hartman"]);
  });
  it("dedupes case-insensitively when a player killed themselves", () => {
    expect(obituaryRoster({ gamertag: "Hartman", killerGamertag: "hartman" })).toEqual(["Hartman"]);
  });
});

// Xbox allows 3-character callsigns. Without a floor, an article about a player named Fox links
// every ordinary "fox" in its own prose — at every occurrence, since §6.3 links them all.
describe("the short-gamertag floor", () => {
  it("drops a 3-character subject from an obituary roster", () => {
    expect(obituaryRoster({ gamertag: "Fox", killerGamertag: "Hartman" })).toEqual(["Hartman"]);
  });

  it("keeps a 4-character subject", () => {
    expect(obituaryRoster({ gamertag: "Bear", killerGamertag: null })).toEqual(["Bear"]);
  });
});
