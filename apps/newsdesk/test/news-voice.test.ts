import { describe, it, expect } from "vitest";
import { NEWS_SYSTEM } from "../src/news-voice.js";

describe("NEWS_SYSTEM — the vendored brand tone rows", () => {
  it("carries the Standing Dead row: elegiac, baffled, warm; never dismissive of a departure", () => {
    expect(NEWS_SYSTEM).toMatch(/elegiac/i);
    expect(NEWS_SYSTEM).toMatch(/baffled/i);
    expect(NEWS_SYSTEM).toMatch(/a eulogy with no death in it/i);
    expect(NEWS_SYSTEM).toMatch(/still standing somewhere/i);
  });

  it("carries both Long Form rows and keeps them opposite", () => {
    expect(NEWS_SYSTEM).toMatch(/reverent/i);
    expect(NEWS_SYSTEM).toMatch(/the sneer is fully off/i);
    expect(NEWS_SYSTEM).toMatch(/cold forensic mock-epic/i);
    expect(NEWS_SYSTEM).toMatch(/nobody leaves it looking good/i);

    // The two registers are opposite and must never blend into one self-contradictory
    // sentence carrying both — each must live on its own line, and neither line may
    // borrow the other's vocabulary.
    const lines = NEWS_SYSTEM.split("\n");
    const freshLine = lines.find((l) => /reverent/i.test(l));
    const gearedLine = lines.find((l) => /cold forensic mock-epic/i.test(l));

    expect(freshLine).toBeDefined();
    expect(gearedLine).toBeDefined();
    expect(freshLine).not.toBe(gearedLine);

    expect(freshLine).toMatch(/the sneer is fully off/i);
    expect(freshLine).not.toMatch(/cold forensic mock-epic/i);
    expect(freshLine).not.toMatch(/nobody leaves it looking good/i);

    expect(gearedLine).toMatch(/nobody leaves it looking good/i);
    expect(gearedLine).not.toMatch(/reverent/i);
    expect(gearedLine).not.toMatch(/the sneer is fully off/i);
  });
});

describe("NEWS_SYSTEM — hard rails", () => {
  it("bans the four forbidden real-player framings by name", () => {
    for (const token of ["the player", "logged off", "stopped playing", "lost interest"]) {
      expect(NEWS_SYSTEM.toLowerCase()).toContain(token);
    }
    expect(NEWS_SYSTEM).toMatch(/second person/i);
  });

  it("states the Fog Rule in its stricter, living-subject form", () => {
    expect(NEWS_SYSTEM).toMatch(/FOG RULE/);
    expect(NEWS_SYSTEM).toMatch(/coordinates/i);
    expect(NEWS_SYSTEM).toMatch(/route/i);
    expect(NEWS_SYSTEM).toMatch(/distance between/i);
  });

  it("declares the block output contract and never asks for a minimum length", () => {
    expect(NEWS_SYSTEM).toContain('"blocks"');
    for (const t of ["para", "subhead", "quote", "list"]) expect(NEWS_SYSTEM).toContain(`"${t}"`);
    // §5: length is FUNDED by fact density, never requested as a floor. A "at least N words"
    // instruction is a padding instruction and would also burn an attempt on a thin cluster.
    expect(NEWS_SYSTEM).not.toMatch(/at least \d+ words/i);
    expect(NEWS_SYSTEM).not.toMatch(/minimum of \d+ words/i);
    expect(NEWS_SYSTEM).not.toMatch(/no fewer than/i);
  });

  it("does not author `body` — the paragraphs are derived from the blocks", () => {
    expect(NEWS_SYSTEM).not.toContain('"body"');
  });

  it("plants no reusable stock phrase for the pull-quote attribution", () => {
    // §10 defect 5: 89 of 123 birth notices reused a byte-identical attribution because the
    // string appeared as an EXAMPLE in the system prompt. This desk ships with no examples.
    expect(NEWS_SYSTEM).not.toMatch(/a voice on the coast/i);
    expect(NEWS_SYSTEM).not.toMatch(/a rival/i);
    expect(NEWS_SYSTEM).toMatch(/never reuse an attribution/i);
  });
});
