import { describe, expect, test } from "vitest";
import {
  SESSION_MAP_COOKIE, alphabeticalMapSlug, resolveMapDestination, type SluggedServer,
} from "./map-resolution";

const chern: SluggedServer = { map: "chernarusplus", slug: "chernarus" };
const sakh: SluggedServer = { map: "sakhal", slug: "sakhal" };
const livonia: SluggedServer = { map: "enoch", slug: "livonia" };
const unslugged: SluggedServer = { map: "namalsk", slug: null };

const FLEET = [chern, sakh, livonia];

describe("alphabeticalMapSlug", () => {
  test("today's fleet resolves to Chernarus", () => {
    // Note this case does NOT discriminate label-order from codename-order: both put Chernarus
    // first. The test below is the one that does.
    expect(alphabeticalMapSlug(FLEET)).toBe("chernarus");
  });

  test("DISCRIMINATING: label order and codename order disagree", () => {
    // `enoch` is the one codename whose label differs from it — MAP_LABEL maps it to "Livonia".
    // Pair it against a codename that falls BETWEEN "enoch" and "livonia":
    //   by codename: "enoch" < "kamyshovo"   -> enoch    -> "livonia"
    //   by label:    "Kamyshovo" < "Livonia" -> kamyshovo -> "kam"
    // So a codename sort returns "livonia" here and this assertion fails.
    const kamyshovo: SluggedServer = { map: "kamyshovo", slug: "kam" };
    expect(alphabeticalMapSlug([livonia, kamyshovo])).toBe("kam");
  });

  test("ignores unslugged servers", () => {
    // Pair against a LATER label so a bug that ignored the slug filter would be visible:
    // "Namalsk" < "Sakhal", so an unslugged server that leaked through would win.
    expect(alphabeticalMapSlug([unslugged, sakh])).toBe("sakhal");
  });

  test("returns null when nothing is slugged", () => {
    expect(alphabeticalMapSlug([unslugged])).toBeNull();
    expect(alphabeticalMapSlug([])).toBeNull();
  });

  test("does not mutate its input", () => {
    const fleet = [sakh, chern];
    alphabeticalMapSlug(fleet);
    expect(fleet).toEqual([sakh, chern]);
  });
});

describe("resolveMapDestination", () => {
  test("session memory wins over everything", () => {
    expect(resolveMapDestination(FLEET, { session: "sakhal", lastPlayed: "livonia" })).toBe("sakhal");
  });

  test("last played wins when there is no session memory", () => {
    expect(resolveMapDestination(FLEET, { session: null, lastPlayed: "livonia" })).toBe("livonia");
  });

  test("falls through to alphabetical when neither memory exists", () => {
    expect(resolveMapDestination(FLEET, { session: null, lastPlayed: null })).toBe("chernarus");
  });

  // ⚠️ Neither memory is trusted without the live list. `GET /servers` returns active servers
  // only, so a retired or re-slugged map must not send anyone to a 404.
  test("a session slug that is no longer in the fleet is discarded", () => {
    expect(resolveMapDestination(FLEET, { session: "deerisle", lastPlayed: null })).toBe("chernarus");
  });

  test("a last-played slug that is no longer in the fleet is discarded", () => {
    expect(resolveMapDestination(FLEET, { session: null, lastPlayed: "deerisle" })).toBe("chernarus");
  });

  test("a stale session slug falls through to last played, not straight to alphabetical", () => {
    // Discriminating: an implementation that bailed to the default on a stale session cookie
    // would return "chernarus" and skip a perfectly good tier 2.
    expect(resolveMapDestination(FLEET, { session: "deerisle", lastPlayed: "sakhal" })).toBe("sakhal");
  });

  test("an unslugged server can never be the destination", () => {
    expect(resolveMapDestination([unslugged], { session: null, lastPlayed: null })).toBeNull();
  });

  test("returns null when there is no slugged server at all", () => {
    expect(resolveMapDestination([], { session: "sakhal", lastPlayed: "livonia" })).toBeNull();
  });
});

describe("the session cookie", () => {
  test("is a new name — ol_last_map is retired", () => {
    expect(SESSION_MAP_COOKIE).toBe("ol_map_session");
    expect(SESSION_MAP_COOKIE).not.toBe("ol_last_map");
  });
});
