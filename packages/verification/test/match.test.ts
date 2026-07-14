import { describe, it, expect } from "vitest";
import { advance } from "../src/index.js";

const SEQ = ["EmoteSalute", "EmoteDance", "EmoteShrug"];

describe("advance", () => {
  it("advances the index on a matching token", () => {
    expect(advance(SEQ, 0, "EmoteSalute")).toEqual({ index: 1, complete: false });
  });
  it("ignores a non-matching token (subsequence semantics)", () => {
    expect(advance(SEQ, 1, "EmoteHeart")).toEqual({ index: 1, complete: false });
  });
  it("completes when the final token matches", () => {
    expect(advance(SEQ, 2, "EmoteShrug")).toEqual({ index: 3, complete: true });
  });
  it("stays complete/clamped past the end", () => {
    expect(advance(SEQ, 3, "EmoteSalute")).toEqual({ index: 3, complete: true });
  });
});
