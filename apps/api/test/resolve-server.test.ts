import { describe, it, expect, beforeAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers } from "@onelife/db";
import { resolveServerBySlug } from "../src/lib/resolve-server.js";

const { db } = getTestDb();

describe("resolveServerBySlug", () => {
  beforeAll(async () => {
    await db.insert(servers).values({ nitradoServiceId: 111, name: "Chernarus", map: "chernarusplus", slug: "chernarus" });
  });
  it("resolves a known slug to its server row", async () => {
    const s = await resolveServerBySlug(db, "chernarus");
    expect(s?.map).toBe("chernarusplus");
    expect(typeof s?.id).toBe("number");
  });
  it("returns null for an unknown slug", async () => {
    expect(await resolveServerBySlug(db, "nope")).toBeNull();
  });
});
