/**
 * The version of the classifier's rules. A stored verdict records the version that wrote it, and
 * a higher number here makes the sweep work every death out again.
 *
 * 0: no rules — `classifyDeath` returned "unknown" for every death.
 * 1: the stated rules (a kill line; a stated mechanism on a bare death line), the post-pass and
 *    the trap-kill evidence. A death only an inferred rule answers is still "unknown".
 */
export const CLASSIFIER_VERSION = 1;
