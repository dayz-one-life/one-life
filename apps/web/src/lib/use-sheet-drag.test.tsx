import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRef } from "react";
import { useSheetDrag } from "./use-sheet-drag";

function pt(type: string, clientY: number, timeStamp: number): PointerEvent {
  const e = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(e, "clientY", { value: clientY });
  Object.defineProperty(e, "timeStamp", { value: timeStamp });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
}

function setup(active = true) {
  const panel = document.createElement("div");
  Object.defineProperty(panel, "offsetHeight", { value: 400 });
  const zone = document.createElement("div");
  zone.setAttribute("data-sheet-drag-zone", "");
  panel.appendChild(zone);
  const body = document.createElement("div");
  panel.appendChild(body);
  document.body.appendChild(panel);
  const onClose = vi.fn();
  renderHook(() => {
    const ref = useRef<HTMLDivElement | null>(panel);
    useSheetDrag(ref, onClose, active);
  });
  return { panel, zone, body, onClose };
}

describe("useSheetDrag", () => {
  test("slow drag past 30% of height dismisses", () => {
    const { zone, onClose } = setup();
    zone.dispatchEvent(pt("pointerdown", 100, 0));
    zone.dispatchEvent(pt("pointermove", 300, 1000)); // 200px of 400 = 50%, 0.2px/ms
    zone.dispatchEvent(pt("pointerup", 300, 1000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("fast flick dismisses even under the distance threshold", () => {
    const { zone, onClose } = setup();
    zone.dispatchEvent(pt("pointerdown", 100, 0));
    zone.dispatchEvent(pt("pointermove", 160, 60)); // 60px (15%) at 1.0px/ms
    zone.dispatchEvent(pt("pointerup", 160, 60));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("short slow drag springs back: no close, transform cleared", () => {
    const { panel, zone, onClose } = setup();
    zone.dispatchEvent(pt("pointerdown", 100, 0));
    zone.dispatchEvent(pt("pointermove", 140, 1000)); // 40px (10%), 0.04px/ms
    expect(panel.style.transform).toBe("translateY(40px)");
    zone.dispatchEvent(pt("pointerup", 140, 1000));
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  test("pointercancel springs back", () => {
    const { panel, zone, onClose } = setup();
    zone.dispatchEvent(pt("pointerdown", 100, 0));
    zone.dispatchEvent(pt("pointermove", 350, 100));
    zone.dispatchEvent(pt("pointercancel", 350, 100));
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  test("drags on the body zone are ignored", () => {
    const { body, panel, onClose } = setup();
    body.dispatchEvent(pt("pointerdown", 100, 0));
    body.dispatchEvent(pt("pointermove", 300, 100));
    body.dispatchEvent(pt("pointerup", 300, 100));
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  test("inactive hook attaches nothing", () => {
    const { zone, onClose } = setup(false);
    zone.dispatchEvent(pt("pointerdown", 100, 0));
    zone.dispatchEvent(pt("pointerup", 400, 100));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("flick then hold before release does not dismiss", () => {
    const { zone, onClose } = setup();
    zone.dispatchEvent(pt("pointerdown", 100, 0));
    zone.dispatchEvent(pt("pointermove", 160, 60)); // 1.0px/ms flick, only 15% of height
    zone.dispatchEvent(pt("pointerup", 160, 1000)); // …but released after a 940ms hold
    expect(onClose).not.toHaveBeenCalled();
  });
});
