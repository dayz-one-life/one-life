/**
 * The version of the classifier's rules. A stored verdict records the version that wrote it, and
 * a higher number here makes the sweep work every death out again.
 *
 * 0: no rules yet — `classifyDeath` returns "unknown" for every death.
 */
export const CLASSIFIER_VERSION = 0;
