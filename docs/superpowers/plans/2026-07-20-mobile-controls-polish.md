# Mobile Controls Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile player-controls surface (pill + bottom sheet) behave natively: swipe-dismiss, enter/exit animation, route-change close, safe-area insets, 16px inputs, 44pt targets, readable type floors, announced errors, and tokenized dark-surface colors.

**Architecture:** A new `useSheetDrag` hook (pointer-events, header-zone-only) plus a two-phase open/close state machine inside `ControlsSheet` (CSS transform transitions, `motion-safe:`). Everything else is surgical class/attribute changes across the controls panels, anchored by four new design tokens.

**Tech Stack:** Next.js App Router, Tailwind tokens (RGB-triple vars), RTL + vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-mobile-controls-polish-design.md`

## Global Constraints

- Web-only; no API/schema changes; no new dependencies; `useModalBehavior` itself is untouched (the mobile menu must not gain drag behavior).
- Dismiss thresholds: displacement > **30%** of sheet height OR downward flick velocity > **0.5 px/ms**. Spring-back 200ms. Enter 250ms ease-out; exit **160ms** ease-in.
- All motion behind `motion-safe:` / a `prefers-reduced-motion` check; reduced-motion close is **instant** (no 400ms zombie panel).
- Drag zone = grabber + header row only (`data-sheet-drag-zone`), never the scrollable body.
- New tokens (exact values): `dark-well` #111111, `dark-hollow` #1A1A12, `dark-edge` #4A4838, `dark-edge-bright` #6A6852. Grep gate: `grep -rn "\[#" apps/web/src/components/controls` returns nothing (shadow `rgba(...)` values are fine).
- Contrast (measured, record in PR): `cream-muted` on `dark` ≈ 5.4:1, on `dark-well` ≈ 5.2:1 — both pass; **no token nudge**.
- Repo conventions: presentational pieces props-only + tested, containers thin; tests via `pnpm --filter @onelife/web run test -- <path>`.
- Branch: `feature/mobile-controls-polish` (created; spec committed).

---

### Task 1: Design tokens + hex sweep

**Files:**
- Modify: `apps/web/src/app/globals.css` (token block, after `--dark-line`)
- Modify: `apps/web/tailwind.config.ts` (color map)
- Modify: `apps/web/src/components/controls/sheet.tsx`, `tokens-panel.tsx`, `link-panel.tsx`, `verify-panel.tsx`, `gamertag-autocomplete.tsx`
- Tests: existing suites (update any assertion pinning the old arbitrary classes)

**Interfaces:**
- Produces: Tailwind utilities `bg-dark-well`, `bg-dark-hollow`, `bg-dark-edge`, `border-dark-edge`, `border-dark-edge-bright`, `hover:bg-dark-hollow` — Task 3 uses `bg-dark-edge` for the grabber.

- [ ] **Step 1: Add the tokens**

In `apps/web/src/app/globals.css`, directly after the `--dark-line: 38 38 28;` line:

```css
  --dark-well: 17 17 17;          /* #111111 — inset field/box background on dark */
  --dark-hollow: 26 26 18;        /* #1A1A12 — current-emote cell background */
  --dark-edge: 74 72 56;          /* #4A4838 — on-dark hardware borders (grabber, dashed boxes) */
  --dark-edge-bright: 106 104 82; /* #6A6852 — bright dashed border (current emote) */
```

In `apps/web/tailwind.config.ts`, alongside `"dark-line": v("dark-line"),`:

```ts
        "dark-well": v("dark-well"),
        "dark-hollow": v("dark-hollow"),
        "dark-edge": v("dark-edge"),
        "dark-edge-bright": v("dark-edge-bright"),
```

- [ ] **Step 2: Sweep the hexes**

Exact replacements (all in `apps/web/src/components/controls/`):
- `sheet.tsx:38` `bg-[#4A4838]` → `bg-dark-edge`
- `sheet.tsx:63` `border-[#4A4838]` → `border-dark-edge`
- `sheet.tsx:111` `bg-[#111]` → `bg-dark-well`
- `tokens-panel.tsx:57` and `:82` `bg-[#111]` → `bg-dark-well`
- `link-panel.tsx` (claim input) `bg-[#111]` → `bg-dark-well`
- `verify-panel.tsx:65` `border-[#6A6852]` → `border-dark-edge-bright`; `bg-[#1A1A12]` → `bg-dark-hollow`
- `gamertag-autocomplete.tsx:71` `bg-[#111]` → `bg-dark-well`; `:82` `hover:bg-[#1A1A12]` → `hover:bg-dark-hollow`

- [ ] **Step 3: Grep gate + suite**

Run: `grep -rn "\[#" apps/web/src/components/controls` → expect empty.
Run: `pnpm --filter @onelife/web run test` → all green (update any test that pinned the old arbitrary classes to pin the token class instead — same assertion strength, new name).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/tailwind.config.ts apps/web/src/components/controls
git commit -m "refactor(web): tokenize the dark-surface hexes (dark-well/hollow/edge)"
```

---

### Task 2: `useSheetDrag` hook

**Files:**
- Create: `apps/web/src/lib/use-sheet-drag.ts`
- Test: `apps/web/src/lib/use-sheet-drag.test.tsx`

**Interfaces:**
- Produces: `useSheetDrag(panelRef: RefObject<HTMLDivElement | null>, onClose: () => void, active: boolean): void` — Task 3 calls it with `active = (phase === "open")`. Attaches to the child marked `data-sheet-drag-zone`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/use-sheet-drag.test.tsx`:

```tsx
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @onelife/web run test -- src/lib/use-sheet-drag.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/use-sheet-drag.ts`:

```ts
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
    const onUp = () => {
      if (!dragging) return;
      const dy = lastY - startY;
      settle(dy > panel.offsetHeight * DISMISS_FRACTION || velocity > DISMISS_VELOCITY);
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
```

- [ ] **Step 4: Run to green**

Run: `pnpm --filter @onelife/web run test -- src/lib/use-sheet-drag.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-sheet-drag.ts apps/web/src/lib/use-sheet-drag.test.tsx
git commit -m "feat(web): useSheetDrag swipe-to-dismiss hook"
```

---

### Task 3: `ControlsSheet` — two-phase animation, route-close, drag zone, safe area

**Files:**
- Modify: `apps/web/src/components/controls/sheet.tsx` (the `ControlsSheet` component only; `SheetUnban`/`SheetServerRow` are Task 5's)
- Test: create `apps/web/src/components/controls/sheet.test.tsx`

**Interfaces:**
- Consumes: `useSheetDrag(panelRef, onClose, active)` (Task 2); `useModalBehavior(open, onClose)` (existing); `bg-dark-edge` (Task 1).
- Produces: same external props (`{ open, onClose, header, children }`) — `MobileControls` is untouched.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/controls/sheet.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { ControlsSheet } from "./sheet";

const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

function matchMediaStub(reduce: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  vi.useRealTimers();
  mockPathname.mockReturnValue("/");
  matchMediaStub(false);
});

const sheet = (open: boolean, onClose = vi.fn()) => (
  <ControlsSheet open={open} onClose={onClose} header={<span>Boots</span>}>
    <p>Body</p>
  </ControlsSheet>
);

describe("ControlsSheet", () => {
  test("closed renders nothing; open renders the dialog with a drag zone", () => {
    const { rerender } = render(sheet(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(sheet(true));
    const dialog = screen.getByRole("dialog", { name: "Player controls" });
    expect(dialog.querySelector("[data-sheet-drag-zone]")).not.toBeNull();
  });

  test("two-phase close: DOM survives closing, unmounts after the exit", () => {
    vi.useFakeTimers();
    const { rerender } = render(sheet(true));
    rerender(sheet(false));
    // Still mounted during the exit phase…
    expect(screen.getByRole("dialog")).toHaveClass("translate-y-full");
    // …gone after the safety timeout.
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("reduced motion closes instantly", () => {
    matchMediaStub(true);
    const { rerender } = render(sheet(true));
    rerender(sheet(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("route change closes the sheet", () => {
    const onClose = vi.fn();
    const { rerender } = render(sheet(true, onClose));
    mockPathname.mockReturnValue("/players/boots");
    rerender(sheet(true, onClose));
    expect(onClose).toHaveBeenCalled();
  });

  test("scrim click and × still close", () => {
    const onClose = vi.fn();
    const { container } = render(sheet(true, onClose));
    fireEvent.click(container.querySelector(".bg-dark\\/55")!);
    fireEvent.click(screen.getByRole("button", { name: "Close controls" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("safe-area padding and dvh cap are present", () => {
    render(sheet(true));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[85dvh]");
    expect(dialog.innerHTML).toContain("safe-area-inset-bottom");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @onelife/web run test -- src/components/controls/sheet.test.tsx`
Expected: FAIL (no drag zone, no phases, vh not dvh).

- [ ] **Step 3: Rewrite `ControlsSheet`**

Replace the `ControlsSheet` function in `apps/web/src/components/controls/sheet.tsx` (imports at top of file gain `useEffect, useRef, useState` from react, `usePathname` from `next/navigation`, and `useSheetDrag` from `@/lib/use-sheet-drag`):

```tsx
type Phase = "closed" | "enter" | "open" | "closing";

/** Bottom sheet chrome (canvas 10c): overlay + dark panel with a real swipe-dismiss handle.
 *  Open/close runs a two-phase transform transition (250ms in / 160ms out, motion-safe);
 *  reduced motion keeps the old instant mount/unmount. Any route change dismisses the sheet
 *  so a tapped link can never leave chrome over its destination. */
export function ControlsSheet({
  open,
  onClose,
  header,
  children,
}: {
  open: boolean;
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("closed");
  const mounted = phase !== "closed";
  const panelRef = useModalBehavior(mounted, onClose);
  useSheetDrag(panelRef, onClose, phase === "open");

  // Enter: mount offscreen, slide up next frame. Close: play the exit, unless reduced
  // motion wants it instant (a 400ms zombie panel is worse than no animation).
  useEffect(() => {
    if (open) {
      setPhase((p) => (p === "closed" ? "enter" : p));
      const raf = requestAnimationFrame(() => setPhase((p) => (p === "enter" ? "open" : p)));
      return () => cancelAnimationFrame(raf);
    }
    setPhase((p) => {
      if (p === "closed") return p;
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "closed" : "closing";
    });
  }, [open]);

  // Safety net: closing must always reach closed even if transitionend never fires.
  useEffect(() => {
    if (phase !== "closing") return;
    const t = setTimeout(() => setPhase("closed"), 400);
    return () => clearTimeout(t);
  }, [phase]);

  // Navigate-under-chrome bug class: any navigation from inside the sheet dismisses it.
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      if (open) onClose();
    }
  }, [pathname, open, onClose]);

  if (!mounted) return null;
  const out = phase === "enter" || phase === "closing";
  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-dark/55 motion-safe:transition-opacity motion-safe:duration-200",
          out ? "opacity-0" : "opacity-100",
        )}
      />
      <div
        id="controls-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Player controls"
        ref={panelRef}
        tabIndex={-1}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && phase === "closing") setPhase("closed");
        }}
        className={cn(
          "absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto border-t-[3px] border-red bg-dark shadow-[0_-18px_40px_rgba(0,0,0,.45)]",
          "motion-safe:transition-transform",
          phase === "closing"
            ? "motion-safe:duration-[160ms] motion-safe:ease-in"
            : "motion-safe:duration-[250ms] motion-safe:ease-out",
          out ? "translate-y-full" : "translate-y-0",
        )}
      >
        <div data-sheet-drag-zone className="cursor-grab touch-none">
          <div aria-hidden className="mx-auto mt-2.5 h-1 w-11 rounded-sm bg-dark-edge" />
          <div className="flex items-center gap-3 border-b border-dark-line px-[18px] py-3">
            <div className="min-w-0 flex-1">{header}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close controls"
              className="flex h-11 w-11 flex-none items-center justify-center text-2xl leading-none text-cream-muted hover:text-paper"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-[18px] pb-[calc(20px+env(safe-area-inset-bottom))] pt-3.5">
          {children}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to green**

Run: `pnpm --filter @onelife/web run test -- src/components/controls/sheet.test.tsx src/components/controls/mobile-controls.test.tsx`
Expected: new suite passes; the existing mobile-controls suite stays green (if any of its tests render the sheet and assert immediate unmount on close, update them to advance timers or stub reduced-motion — note which in the report).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls/sheet.tsx apps/web/src/components/controls/sheet.test.tsx
git commit -m "feat(web): sheet swipe-dismiss, enter/exit animation, route-close, safe area"
```

---

### Task 4: Pill safe-area offsets

**Files:**
- Modify: `apps/web/src/components/controls/pill.tsx` (both `SignInPill` and `ControlsPillView`)

**Interfaces:** none new — class-only.

- [ ] **Step 1: Change the offsets**

In both fixed containers, replace `bottom-3.5` with `bottom-[calc(14px+env(safe-area-inset-bottom))]` (`inset-x-3.5` stays).

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @onelife/web run test -- src/components/controls`
Expected: green (update any pinned `bottom-3.5` assertion to the new class).

```bash
git add apps/web/src/components/controls/pill.tsx
git commit -m "fix(web): pill respects the iOS safe area"
```

---

### Task 5: Inputs — 16px on mobile, dropdown containment, focus scroll

**Files:**
- Modify: `apps/web/src/components/controls/tokens-panel.tsx` (both `inputClassName`s)
- Modify: `apps/web/src/components/controls/link-panel.tsx` (claim `inputClassName`)
- Modify: `apps/web/src/components/controls/gamertag-autocomplete.tsx` (dropdown + focus)
- Tests: extend `apps/web/src/components/controls/tokens-panel.test.tsx` (or the existing panel test file)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

Add to the tokens-panel test file:

```tsx
  test("inputs are 16px below xl so iOS Safari does not zoom on focus", () => {
    render(<TokensPanel balance={1} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    const input = screen.getByLabelText("Send a token to a verified player");
    expect(input.className).toContain("text-base");
    expect(input.className).toContain("xl:text-[11.5px]");
  });
```

(Reuse the file's existing `idle`/mutation-view fixture; if it's named differently, use that name.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @onelife/web run test -- src/components/controls/tokens-panel.test.tsx`
Expected: the new test FAILS on `text-base`.

- [ ] **Step 3: Implement**

- `tokens-panel.tsx`: in both `inputClassName` strings, replace `text-[11.5px]` with `text-base xl:text-[11.5px]`.
- `link-panel.tsx`: in the claim `inputClassName`, replace `text-[13px]` with `text-base xl:text-[13px]`.
- `gamertag-autocomplete.tsx`:
  - On the `<ul>` dropdown, append `max-h-[210px] overflow-y-auto` (≈5 rows with internal scroll).
  - On the `<input>`, add a focus handler so the software keyboard cannot hide it:
    ```tsx
    onFocus={(e) =>
      e.currentTarget.scrollIntoView?.({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      })
    }
    ```

- [ ] **Step 4: Run to green + device note**

Run: `pnpm --filter @onelife/web run test -- src/components/controls`
Expected: PASS. Add to your report: **manual device check still required** for dropdown clipping against the sheet scroller (spec §5) — if clipping reproduces on-device, the sanctioned fallback is in-flow dropdown rendering on the sheet surface; do NOT implement it speculatively.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls
git commit -m "fix(web): 16px mobile inputs, contained dropdown, focus scroll-into-view"
```

---

### Task 6: Touch targets, type floors, announced errors

**Files:**
- Modify: `apps/web/src/components/controls/sheet.tsx` (`SheetUnban`, `SheetServerRow` text sizes)
- Modify: `apps/web/src/components/controls/verify-panel.tsx` (`quietBtn`)
- Modify: `apps/web/src/components/controls/tokens-panel.tsx` (helper line, "Set", errors)
- Modify: `apps/web/src/components/controls/link-panel.tsx` (error)
- Modify: `apps/web/src/components/controls/mobile-controls.tsx` (footer links)
- Tests: extend the panels' existing test files

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests**

Add (to the respective existing test files):

```tsx
  // verify-panel tests
  test("cancel claim is a 44pt target below xl and announces nothing by itself", () => {
    render(<ProveItPanel gamertag="Boots" challenge={activeChallenge} now={NOW} onCancel={() => {}} onReclaim={() => {}} />);
    const btn = screen.getByRole("button", { name: "Cancel claim" });
    expect(btn.className).toContain("min-h-[44px]");
    expect(btn.className).toContain("xl:min-h-0");
  });

  // tokens-panel tests
  test("send errors announce via role=alert", () => {
    render(<TokensPanel balance={1} send={{ pending: false, ok: false, error: "Not enough tokens" }} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough tokens");
  });

  // link-panel tests
  test("claim errors announce via role=alert", () => {
    render(<LinkTagPanel onClaim={() => {}} pending={false} error="Tag already claimed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Tag already claimed");
  });
```

(Adapt fixture names to each file's existing helpers; `activeChallenge`/`NOW` exist in the verify-panel tests — reuse them.)

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @onelife/web run test -- src/components/controls`
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**

Exact changes:

*Targets (mobile-only floor, rail density preserved):*
- `verify-panel.tsx` `quietBtn` constant becomes:
  ```ts
  const quietBtn =
    "inline-flex min-h-[44px] items-center font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted underline underline-offset-2 hover:text-paper disabled:opacity-50 xl:min-h-0 xl:text-[10.5px]";
  ```
- `tokens-panel.tsx` referrer "Set" button: prepend `inline-flex min-h-[44px] items-center xl:min-h-0 ` to its className.
- `mobile-controls.tsx` footer: both the profile `Link` and the Sign out `button` get `inline-flex min-h-[44px] items-center ` prepended (sheet-only surface — no `xl:` needed) and their `text-[10px]` raised to `text-[11px]`.

*Type floors (sheet-only components change unconditionally):*
- `sheet.tsx` `SheetServerRow`: fact line `text-[10px]` → `text-[12px]`; "Ban lifts in" `text-[9.5px]` → `text-[12px]`.
- `sheet.tsx` `SheetUnban`: both `text-[10px]` → `text-[11px]`.
- `tokens-panel.tsx` helper line (`+1 every 1st…`): `text-[10px]` → `text-[11px] xl:text-[10px]` (renders on both surfaces).

*Announced errors:*
- `tokens-panel.tsx`: add `role="alert"` to the `send.error` and `referrer.error` `<p>`s.
- `link-panel.tsx`: add `role="alert"` to the error `<p>`.

- [ ] **Step 4: Run the controls suite to green**

Run: `pnpm --filter @onelife/web run test -- src/components/controls`
Expected: PASS, including previously-existing assertions (update any that pinned the old sizes — same strength, new values).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls apps/web/src/components/controls/mobile-controls.tsx
git commit -m "fix(web): 44pt quiet actions, sheet type floors, role=alert errors"
```

---

### Task 7: CHANGELOG, CLAUDE.md, full verification

**Files:**
- Modify: `CHANGELOG.md`; Modify: `CLAUDE.md`

**Interfaces:** docs only.

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]` → `### Fixed` (this batch is polish/fixes, not a new capability):

```markdown
- Mobile player controls polish: the bottom sheet now swipe-dismisses from its handle, animates
  in/out (instant under reduced motion), and closes itself on any navigation; the pill and sheet
  respect the iOS safe area; inputs are 16px on mobile so iOS Safari stops zooming on focus;
  quiet actions meet 44pt; the sheet's smallest type rises to a readable floor; form errors
  announce to screen readers; and the dark surface's hardcoded hexes became named tokens
  (`dark-well`/`dark-hollow`/`dark-edge`/`dark-edge-bright`).
```

- [ ] **Step 2: CLAUDE.md**

In the R3 controls rail section, append one sentence noting: the sheet has swipe-dismiss (`useSheetDrag`, header-zone only), a two-phase motion-safe enter/exit, and closes on route change; the controls dark surface uses the four named tokens (no raw hexes — grep-gated).

- [ ] **Step 3: Full verification**

Run: `pnpm turbo run typecheck && pnpm --filter @onelife/web run test`
Expected: both green.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for mobile controls polish"
```

Then hand off to the `finishing-a-feature` skill for the PR into `develop`.
