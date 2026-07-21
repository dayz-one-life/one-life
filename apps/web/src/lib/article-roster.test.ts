import { describe, it, expect } from "vitest";
import { obituaryRoster, birthNoticeRoster, newsRoster } from "./article-roster";

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

describe("birthNoticeRoster", () => {
  it("is just the subject", () => {
    expect(birthNoticeRoster({ gamertag: "Pyle" })).toEqual(["Pyle"]);
  });
});

describe("newsRoster", () => {
  it("includes the article gamertag and every listed subject", () => {
    const roster = newsRoster({
      gamertag: "Hartman",
      subjects: [
        { gamertag: "Pyle", mapSlug: "sakhal", lifeNumber: 3 },
        { gamertag: "Cowboy", mapSlug: null, lifeNumber: 1 },
      ],
    });
    expect(roster).toEqual(["Hartman", "Pyle", "Cowboy"]);
  });
  it("handles an editorial piece with a null gamertag", () => {
    expect(newsRoster({ gamertag: null, subjects: [{ gamertag: "Pyle", mapSlug: null, lifeNumber: 1 }] })).toEqual(["Pyle"]);
  });
  it("returns an empty roster when nothing is named", () => {
    expect(newsRoster({ gamertag: null, subjects: [] })).toEqual([]);
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

  it("drops short names from a birth notice and a news piece too", () => {
    expect(birthNoticeRoster({ gamertag: "Ace" })).toEqual([]);
    expect(
      newsRoster({ gamertag: "Doc", subjects: [{ gamertag: "Wolfe", mapSlug: null, lifeNumber: 1 }] }),
    ).toEqual(["Wolfe"]);
  });
});
