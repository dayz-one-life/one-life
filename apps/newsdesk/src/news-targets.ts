// One import surface for the R5d news triggers. newsTick (PR-C2) imports from HERE, never from
// the two implementation files — the split between `standing-dead-targets.ts` and
// `long-form-targets.ts` is an implementation detail of this slice.
export * from "./standing-dead-targets.js";
export * from "./long-form-targets.js";
