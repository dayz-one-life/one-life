const TAGLINES: Record<string, string> = {
  chernarus: "THE CLASSIC. 230 KM² OF POOR JUDGMENT AND WORSE WEATHER.",
  livonia: "WET, GREEN, QUIET. THE QUIET IS BAIT. THE WOLVES ARE ORGANIZED.",
  sakhal: "VOLCANIC AND FROZEN AT ONCE. THE ISLAND KILLS MORE THAN THE PLAYERS.",
};

export function serverTagline(slug: string): string {
  return TAGLINES[slug] ?? "NEW BUREAU. THE DESK IS STILL WRITING THE INSULT.";
}

/** "A", "A or B", "A, B, or C" */
export function formatOrList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

const WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];
export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}
