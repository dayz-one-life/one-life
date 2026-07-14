/**
 * In-order subsequence step. A matching token at the current index advances progress;
 * any other token is ignored (progress holds). `complete` when the whole sequence is matched.
 */
export function advance(
  sequence: string[],
  progressIndex: number,
  emoteToken: string,
): { index: number; complete: boolean } {
  const index =
    progressIndex < sequence.length && sequence[progressIndex] === emoteToken
      ? progressIndex + 1
      : progressIndex;
  return { index, complete: index === sequence.length };
}
