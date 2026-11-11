import { describe, it, expect } from "vitest";
import { CREDIT_TEXT, TRAP_QUALIFIED_LINE as VOCAB_QUALIFIED_LINE } from "@onelife/death-verdict";
import { TRAP_LIST_FOOTNOTE, TRAP_LIST_LABEL, TRAP_QUALIFIED_LINE, creditSentenceBody, creditSuffix } from "./trap-kill";

describe("trap-kill strings", () => {
  it("match the vocabulary in @onelife/death-verdict for both devices", () => {
    for (const device of ["tripwire", "land_mine"] as const) {
      expect(TRAP_LIST_LABEL).toBe(CREDIT_TEXT[device].listLabel);
      expect(TRAP_LIST_FOOTNOTE).toBe(CREDIT_TEXT[device].listFootnote);
      expect(creditSuffix("Placer Person")).toBe(CREDIT_TEXT[device].sentenceSuffix("Placer Person"));
    }
    expect(TRAP_QUALIFIED_LINE).toBe(VOCAB_QUALIFIED_LINE);
  });

  it("takes the credit suffix off a credited sentence, and nothing else", () => {
    const credit = { gamertag: "Placer Person", basis: "trap_placement", device: "tripwire", byOperator: false } as const;
    expect(creditSentenceBody("Killed by a land mine. Kill credited to Placer Person.", credit)).toBe("Killed by a land mine.");
    expect(creditSentenceBody("Killed by a land mine.", credit)).toBe("Killed by a land mine.");
    expect(creditSentenceBody("Killed by a land mine. Kill credited to Placer Person.", null)).toBe("Killed by a land mine. Kill credited to Placer Person.");
  });
});
