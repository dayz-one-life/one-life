import { describe, it, expect, vi } from "vitest";
import { NitradoClient } from "../src/index.js";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("NitradoClient.listAdmFiles", () => {
  it("resolves base path, lists ADM files oldest-first with parsed timestamps", async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/gameservers?") || u.endsWith("/gameservers")) {
        return jsonResponse({ data: { gameserver: { game_specific: { path: "/games/x/noftp/dayzxb/" } } } });
      }
      if (u.includes("/file_server/list")) {
        return jsonResponse({ data: { entries: [
          { name: "DayZServer_X1_x64_2026-07-06_12-51-59.ADM", path: "/games/x/noftp/dayzxb/config/DayZServer_X1_x64_2026-07-06_12-51-59.ADM", modified_at: 1751811119 },
          { name: "DayZServer_X1_x64_2026-07-05_10-00-00.ADM", path: "/games/x/noftp/dayzxb/config/DayZServer_X1_x64_2026-07-05_10-00-00.ADM", modified_at: 1751709600 },
          { name: "notes.txt", path: "/games/x/noftp/dayzxb/config/notes.txt", modified_at: 1 },
        ] } });
      }
      throw new Error("unexpected url " + u);
    });

    const client = new NitradoClient("tok", 18196786, fetchFn as unknown as typeof fetch);
    const files = await client.listAdmFiles();
    expect(files.map((f) => f.name)).toEqual([
      "DayZServer_X1_x64_2026-07-05_10-00-00.ADM",
      "DayZServer_X1_x64_2026-07-06_12-51-59.ADM",
    ]);
    expect(files[1]!.localTimestampMs).toBe(Date.UTC(2026, 6, 6, 12, 51, 59));
    expect(files[1]!.modifiedAtMs).toBe(1751811119 * 1000);
  });
});

describe("NitradoClient.downloadFile", () => {
  it("follows the returned token url", async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/file_server/download")) {
        return jsonResponse({ data: { token: { url: "https://dl.nitrado/abc" } } });
      }
      if (u === "https://dl.nitrado/abc") {
        return new Response("line1\nline2\n", { status: 200 });
      }
      throw new Error("unexpected url " + u);
    });
    const client = new NitradoClient("tok", 1, fetchFn as unknown as typeof fetch);
    expect(await client.downloadFile("/some/file.ADM")).toBe("line1\nline2\n");
  });
});
