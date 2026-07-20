"use client";
import { useEffect, useRef, type RefObject } from "react";

const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 0.5; // px/ms, downward

/** Swipe-to-dismiss for the bottom sheet (spec §2). Attaches pointer handlers to the child of
 *  `panelRef` marked `data-sheet-drag-zone` — the grabber + header row, never the scrollable
 *  body, which must keep scrolling. The panel tracks the finger 1:1 (class transitions
 *  suspended via an inline `transition: none`), then dismisses past 30% of its height or a
 *  0.5 px/ms downward flick, else springs back (the inline overrides are cleared, letting the
 *  class-driven 200ms transition play). Dismissal calls `onClose`, so the shared close path
 *  (exit animation, focus restore) runs. */
export function useSheetDrag(
  panelRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  active: boolean,
): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    const zone = panel?.querySelector<HTMLElement>("[data-sheet-drag-zone]");
    if (!panel || !zone) return;

    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dragging = false;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      startY = lastY = e.clientY;
      lastT = e.timeStamp;
      velocity = 0;
      panel.style.transition = "none";
      zone.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = e.timeStamp;
      const dy = Math.max(0, e.clientY - startY);
      panel.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
    };
    const settle = (dismiss: boolean) => {
      dragging = false;
      panel.style.transition = "";
      panel.style.transform = "";
      if (dismiss) onCloseRef.current();
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      const dy = lastY - startY;
      // A pause before release means the flick was abandoned — a >100ms-old velocity
      // sample must not dismiss on its own.
      const v = e.timeStamp - lastT > 100 ? 0 : velocity;
      settle(dy > panel.offsetHeight * DISMISS_FRACTION || v > DISMISS_VELOCITY);
    };
    const onCancel = () => {
      if (dragging) settle(false);
    };

    zone.addEventListener("pointerdown", onDown);
    zone.addEventListener("pointermove", onMove);
    zone.addEventListener("pointerup", onUp);
    zone.addEventListener("pointercancel", onCancel);
    return () => {
      zone.removeEventListener("pointerdown", onDown);
      zone.removeEventListener("pointermove", onMove);
      zone.removeEventListener("pointerup", onUp);
      zone.removeEventListener("pointercancel", onCancel);
    };
  }, [panelRef, active]);
}
