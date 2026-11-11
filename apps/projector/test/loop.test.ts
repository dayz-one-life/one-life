import { describe, it, expect, vi } from "vitest";
import type { Database } from "@onelife/db";
import { runLoopOnce, type LoopDeps } from "../src/loop.js";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const SWEPT = { written: 1, failed: 0, held: 0, rederived: 0 };

function deps(over: Partial<LoopDeps> = {}): LoopDeps {
  return {
    db: {} as Database, cfg: { batchSize: 500 }, log,
    tick: vi.fn(async () => ({ applied: 3, skipped: 0 })),
    sweep: vi.fn(async () => SWEPT),
    cursorBehind: vi.fn(async () => false),
    ...over,
  };
}

describe("runLoopOnce", () => {
  it("a sweep failure does not stop the next tick", async () => {
    const d = deps({ sweep: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(runLoopOnce(d)).resolves.toEqual({ applied: 3, behind: false });
    await expect(runLoopOnce(d)).resolves.toEqual({ applied: 3, behind: false });
    expect(d.tick).toHaveBeenCalledTimes(2);
    expect(d.sweep).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledWith(expect.anything(), "verdict_sweep failed");
  });

  it("the sweep is skipped while the projector is behind", async () => {
    // a full batch: more events are waiting
    const full = deps({ tick: vi.fn(async () => ({ applied: 498, skipped: 2 })) });
    expect(await runLoopOnce(full)).toEqual({ applied: 498, behind: true });
    expect(full.sweep).not.toHaveBeenCalled();
    // a short batch, but the cursor is still below the newest event
    const lagging = deps({ cursorBehind: vi.fn(async () => true) });
    expect((await runLoopOnce(lagging)).behind).toBe(true);
    expect(lagging.sweep).not.toHaveBeenCalled();
    // caught up
    const caughtUp = deps();
    expect((await runLoopOnce(caughtUp)).behind).toBe(false);
    expect(caughtUp.sweep).toHaveBeenCalledTimes(1);
  });

  it("a failing tick skips the sweep and does not throw", async () => {
    const d = deps({ tick: vi.fn(async () => { throw new Error("db down"); }) });
    expect(await runLoopOnce(d)).toEqual({ applied: 0, behind: true });
    expect(d.sweep).not.toHaveBeenCalled();
  });
});
