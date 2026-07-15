import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { rebooterTick, type RestartClient } from "../src/tick.js";

const { db, sql } = getTestDb();
const log = { info: () => {}, error: () => {} };

/** Records restart calls per service id; `failOn` service ids throw. */
function fakeNitrado(failOn: number[] = []) {
  const restarted: number[] = [];
  const nitradoFor = (sid: number): RestartClient => ({
    async restartServer() {
      if (failOn.includes(sid)) throw new Error(`boom ${sid}`);
      restarted.push(sid);
    },
  });
  return { restarted, nitradoFor };
}

beforeAll(async () => {
  await db.insert(servers).values({ nitradoServiceId: 900001, name: "alpha", active: true });
  await db.insert(servers).values({ nitradoServiceId: 900002, name: "bravo", active: true });
  await db.insert(servers).values({ nitradoServiceId: 900003, name: "charlie", active: false });
});
afterAll(async () => { await sql.end(); });

describe("rebooterTick", () => {
  it("restarts every active server and skips inactive ones", async () => {
    const fake = fakeNitrado();
    const r = await rebooterTick(db, { nitradoFor: fake.nitradoFor, log });
    expect(fake.restarted.sort()).toEqual([900001, 900002]);
    expect(r).toEqual({ restarted: 2, failed: 0 });
  });

  it("is best-effort: one server failing does not stop the others", async () => {
    const fake = fakeNitrado([900001]);
    const r = await rebooterTick(db, { nitradoFor: fake.nitradoFor, log });
    expect(fake.restarted).toEqual([900002]); // bravo still restarted
    expect(r).toEqual({ restarted: 1, failed: 1 });
  });
});
