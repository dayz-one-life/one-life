import { describe, it, expect } from "vitest";
import { playerSlug } from "./slug";

describe("playerSlug", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(playerSlug("xSgt Hartman")).toBe("xsgt-hartman");
  });
  it("collapses punctuation and repeated separators", () => {
    expect(playerSlug("f3aR_fAcToRy.89")).toBe("f3ar-factory-89");
  });
  it("trims leading/trailing separators", () => {
    expect(playerSlug(" -Twhizzle4life- ")).toBe("twhizzle4life");
  });
});
