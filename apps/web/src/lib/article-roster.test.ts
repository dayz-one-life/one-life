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
