"use client";
import { useEffect, useRef, useState } from "react";

/** Pure scaling rule: measure the final string at `basePx`, scale by container/clone, clamp.
 *  A clone width of 0 means the environment can't measure (jsdom, display:none ancestors) —
 *  keep the CSS fallback size rather than dividing by zero into Infinity. */
export function fitFontSize(cloneWidth: number, containerWidth: number, basePx: number, minPx: number, maxPx: number): number {
  if (cloneWidth <= 0 || containerWidth <= 0) return basePx;
  return Math.min(maxPx, Math.max(minPx, basePx * (containerWidth / cloneWidth)));
}

const BASE_PX = 50;
const MIN_PX = 28;
const MAX_PX = 180;

/**
 * Renders a single nowrap line sized so `finalText` fills the container width.
 *
 * The measurement target is a hidden CLONE carrying the FINAL string — never the live children,
 * whose CountUp digits are mid-animation at mount (spec §5). `tabular-nums` upstream keeps the
 * final string the widest the line will be. SSR/jsdom render at the CSS fallback size; the
 * effect upgrades it after mount and re-runs on resize via ResizeObserver.
 */
export function FitLine({ finalText, className = "", lineClassName = "", children }: {
  finalText: string;
  className?: string;
  /** CSS fallback size for the VISIBLE line only (never the measuring clone, which is always
   *  fixed at BASE_PX) — pre-hydration and no-JS both paint at this size; the measured inline
   *  `fontSize` overrides it once the effect lands, so there is no CLS jump from a UA default. */
  lineClassName?: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cloneRef = useRef<HTMLSpanElement>(null);
  const [sizePx, setSizePx] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const clone = cloneRef.current;
    if (!container || !clone) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = fitFontSize(clone.scrollWidth, container.clientWidth, BASE_PX, MIN_PX, MAX_PX);
        setSizePx((prev) => (prev === next ? prev : next));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [finalText]);

  return (
    <div ref={containerRef} className={className}>
      {/* Measuring clone: same type styles via inherit, fixed BASE_PX, invisible, out of flow. */}
      <span
        ref={cloneRef}
        data-fitline-clone
        aria-hidden="true"
        className="pointer-events-none invisible absolute whitespace-nowrap"
        style={{ fontSize: BASE_PX }}
      >
        {finalText}
      </span>
      <div
        className={`whitespace-nowrap ${lineClassName}`}
        style={sizePx !== null ? { fontSize: sizePx } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
