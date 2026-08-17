/**
 * World metres → the 3-digit grid pair players say out loud ("zero six seven, zero two three").
 *
 * Metres ÷ 100, truncated (the square you are IN, not the nearest one) and zero-padded so the
 * readout never changes width while panning. Negative values — panning past the map edge —
 * clamp to zero rather than printing a minus sign that is not a grid reference.
 */
export function gridRef(x: number, y: number): string {
  const cell = (v: number) => String(Math.max(0, Math.floor(v / 100))).padStart(3, "0");
  return `${cell(x)} ${cell(y)}`;
}
