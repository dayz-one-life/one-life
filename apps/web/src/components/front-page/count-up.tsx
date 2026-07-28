"use client";
import { useEffect, useState } from "react";

/**
 * The ledger's mortality odometer. The initial render — which is also the SSR/no-JS HTML — is
 * the REAL final value (SEO and curl see the truth); only after hydration, and only when the
 * visitor allows motion, does it restart from 0 and sprint up (~1.5s, ease-out cubic, so it
 * slams into the final figure).
 *
 * ⚠️ `aria-hidden` is load-bearing: a screen reader must never hear ticking digits. The hero
 * carries the final numbers in an `sr-only` sentence instead.
 */
export function CountUp({ value, durationMs = 1500 }: { value: number; durationMs?: number }) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let start: number | null = null;
    const tick = (t: number) => {
      start ??= t;
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(eased * value));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <span aria-hidden="true">{shown.toLocaleString("en-US")}</span>;
}
