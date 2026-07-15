import { describe, it, expect } from "vitest";
import { parseRptFile } from "../src/parse.js";

const HEADER = "Current time:  2026/07/11 11:38:05\nVersion 1.29.163047\n\n";
const parse = (body: string) => parseRptFile(HEADER + body, { offsetMs: 0 });

// exact real line formats (whitespace preserved where it matters)
const FRESH = [
  "11:56:47.998 [StateMachine]: Player Steveo12491 (dpnid 2126708555 uid D0B9EDC7A5238AB0A559C250E9849B23D2629915) Entering GetNewCharLoginState",
  "11:56:48.14   WORLD        : Create entity type 'ZmbM_HunterOld_Autumn'",  // AI — must be ignored
  "11:56:48.14   WORLD        : Create entity type 'SurvivorF_Linda'",
  "11:56:50.179 Warning: No components in dz\\characters\\heads\\f_linda_2.p3d:geometry",
  "11:56:50.195 Player Steveo12491 (id=D0B9EDC7A5238AB0A559C250E9849B23D2629915 pos=<13065.4, 12122.1, 14.0>) has connected.",
  "11:56:50.195 <CREATE NEW CHAR>:",
  "    charID 1",
  "    playerID 1",
  "    dpnid 2126708555",
  "    uid D0B9EDC7A5238AB0A559C250E9849B23D2629915",
].join("\n");

const EXISTING = [
  "14:03:04.630 [StateMachine]: Player YrJustBad (dpnid 1223205378 uid C87349CA0FCDDE3EAAE617E3E3349B013DD71F0A) Entering GetLoadedCharLoginState",
  "14:03:04.646  WORLD        : Create entity type 'SurvivorM_Cyril'",
  "14:03:07.46  Player YrJustBad (id=C87349CA0FCDDE3EAAE617E3E3349B013DD71F0A pos=<12809.8, 7465.8, 12.5>) has connected.",
  "14:03:07.46  <LOAD EXISTING CHAR>:",
  "    charID 3",
  "    playerID 3",
  "    dpnid 1223205378",
  "    uid C87349CA0FCDDE3EAAE617E3E3349B013DD71F0A",
].join("\n");

describe("parseRptFile", () => {
  it("maps a fresh spawn to a 'new' sighting with class from Create entity (AI ignored)", () => {
    const s = parse(FRESH);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      gamertag: "Steveo12491", charId: 1, playerDbId: 1, kind: "new",
      characterClass: "SurvivorF_Linda", classSource: "create_entity", x: 13065.4,
    });
    expect(s[0]!.observedAt.toISOString()).toBe("2026-07-11T11:56:50.195Z");
  });

  it("maps an existing-char login to an 'existing' sighting", () => {
    const s = parse(EXISTING);
    expect(s[0]).toMatchObject({ gamertag: "YrJustBad", charId: 3, kind: "existing", characterClass: "SurvivorM_Cyril" });
  });

  it("ignores head-asset warnings — class stays null when Create entity is absent", () => {
    // Head-asset warnings carry no player identity and mis-attribute across players (even
    // cross-gender), so they are not a class signal. Without a Create entity line, the sighting
    // is still emitted (charId intact) but the character is undetermined → null → silhouette.
    const body = [
      "12:00:00.0 [StateMachine]: Player KingSioux82 (dpnid 42 uid AAAABBBBCCCCDDDD1111222233334444AAAABBBB) Entering GetLoadedCharLoginState",
      "12:00:01.0 Warning: No components in dz\\characters\\heads\\f_helga.p3d:geometry",
      "12:00:02.0 Player KingSioux82 (id=AAAABBBBCCCCDDDD1111222233334444AAAABBBB pos=<1.0, 2.0, 3.0>) has connected.",
      "12:00:02.0 <LOAD EXISTING CHAR>:",
      "    charID 9", "    playerID 9", "    dpnid 42", "    uid AAAABBBBCCCCDDDD1111222233334444AAAABBBB",
    ].join("\n");
    expect(parse(body)[0]).toMatchObject({ charId: 9, characterClass: null, classSource: null });
  });

  it("abstains on class (null) for overlapping logins but still emits exact charIds", () => {
    const body = [
      "12:00:00.0 [StateMachine]: Player A (dpnid 1 uid AAAA000000000000000000000000000000000000) Entering GetLoadedCharLoginState",
      "12:00:00.5 [StateMachine]: Player B (dpnid 2 uid BBBB000000000000000000000000000000000000) Entering GetLoadedCharLoginState",
      "12:00:01.0 WORLD        : Create entity type 'SurvivorM_Guo'",  // two pending → abstain
      "12:00:02.0 Player A (id=AAAA000000000000000000000000000000000000 pos=<1.0, 1.0, 1.0>) has connected.",
      "12:00:02.0 <LOAD EXISTING CHAR>:",
      "    charID 10", "    playerID 10", "    dpnid 1", "    uid AAAA000000000000000000000000000000000000",
      "12:00:03.0 Player B (id=BBBB000000000000000000000000000000000000 pos=<2.0, 2.0, 2.0>) has connected.",
      "12:00:03.0 <LOAD EXISTING CHAR>:",
      "    charID 11", "    playerID 11", "    dpnid 2", "    uid BBBB000000000000000000000000000000000000",
    ].join("\n");
    const s = parse(body);
    expect(s.map((x) => x.charId).sort()).toEqual([10, 11]);
    expect(s.every((x) => x.characterClass === null)).toBe(true);
  });

  it("emits nothing for a login that never connects (timeout)", () => {
    const body = [
      "12:00:00.0 [StateMachine]: Player Ghost (dpnid 7 uid CCCC000000000000000000000000000000000000) Entering GetLoadedCharLoginState",
      "12:05:00.0 WORLD        : Create entity type 'SurvivorM_Guo'", // 5 min later, no connect
    ].join("\n");
    expect(parse(body)).toEqual([]);
  });
});
