import { describe, it, expect } from "vitest";
import { parseConnecting, parseConnected, parseDisconnected, parseBoot, parseRoster } from "../src/index.js";

describe("basic line parsers", () => {
  it("parses connecting", () => {
    expect(parseConnecting('12:52:38 | Player "Steveo12491" (id=D0B9EDC7=) is connecting'))
      .toEqual({ gamertag: "Steveo12491", dayzId: "D0B9EDC7=" });
    expect(parseConnecting('... is connected')).toBeNull();
  });

  it("parses connected (not connecting)", () => {
    expect(parseConnected('01:02:03 | Player "Alice" (id=ABC123=) is connected'))
      .toEqual({ gamertag: "Alice", dayzId: "ABC123=" });
    expect(parseConnected('... is connecting')).toBeNull();
  });

  it("parses disconnected", () => {
    expect(parseDisconnected('01:02:03 | Player "Bob" (id=XYZ=) has been disconnected'))
      .toEqual({ gamertag: "Bob", dayzId: "XYZ=" });
  });

  it("parses boot header to local datetime", () => {
    expect(parseBoot("AdminLog started on 2026-07-06 at 12:51:59")).toBe("2026-07-06 12:51:59");
    expect(parseBoot("12:00:00 | something")).toBeNull();
  });

  it("parses roster snapshot count", () => {
    expect(parseRoster("12:57:53 | ##### PlayerList log: 4 players")).toEqual({ count: 4 });
    expect(parseRoster("12:57:53 | Player \"A\" (id=A=) is connected")).toBeNull();
  });
});
