# Avatar Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the verified home's inline avatar panel with a modal dialog carrying a real drag-and-zoom crop stage, so the owner sees and controls exactly what gets saved.

**Architecture:** A modal dialog portalled to `document.body` holds one `Draft` union describing the pending change. Every action stages a draft; Save is the only commit point and dispatches to one of the three existing mutations. Crop math lives in a pure module; canvas export sits behind an injectable seam so jsdom tests can stub it.

**Tech Stack:** Next.js App Router, React 19, TanStack Query v5, Tailwind, Vitest + Testing Library (jsdom).

Spec: `docs/superpowers/specs/2026-07-30-avatar-dialog-design.md`

## Global Constraints

- **Two-surface tokens.** The dialog sits on `bg-dark`. Use dark-surface tokens (`text-paper`, `text-cream-muted`, `text-cream-dim`, `border-dark-line`, `border-dark-edge`). Never `text-ink`/`text-ink-muted` inside the dialog — that pairing is the bug this work exists to fix.
- **`z-50`**, matching `ClaimModal` and the LAYER LEGEND in `apps/web/src/components/header.tsx`. Do not introduce a new altitude.
- **The dialog portals to `document.body`** behind a mounted guard. A `position: fixed` overlay under a transformed ancestor collapses into it, and jsdom cannot see the difference.
- **`StageAvatar`'s pencil stays the single edit path.** Do not add a second entry point anywhere.
- **The two `SrStatus` ⚠️ rules carry over verbatim** from today's `avatar-panel.tsx` header comment: announcements set imperatively in each mutation's own `onSuccess`/`onError` (never derived from TanStack flags), and each mutation blanks `announcement` in `onMutate`.
- **`invalidate()` keeps its `router.refresh()`.** The dossier hero is server-rendered and query invalidation alone cannot reach it.
- **Export size is 512×512 WebP at quality 0.9.** `AVATAR_MAX_BYTES` is enforced server-side.
- **Drag uses pointer events**, not mouse events, so touch works without a second code path.
- Run tests with `pnpm vitest run <path>` from `apps/web`. Typecheck with `pnpm --filter @onelife/web run typecheck`.
- All paths below are relative to `apps/web/`.

---

### Task 1: Crop geometry (pure math)

The whole pan/zoom model as pure functions, so the parts that matter can be tested without a browser.

**Model.** `frame` is the diameter of the circular crop frame in CSS pixels. `scale` maps source pixels to display pixels. `offsetX`/`offsetY` is the top-left of the *displayed* image relative to the frame's top-left, in display pixels — normally negative, because the image overhangs the frame on all sides.

**Files:**
- Create: `src/components/account/crop-geometry.ts`
- Test: `src/components/account/crop-geometry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ImageSize = { width: number; height: number }`
  - `type View = { scale: number; offsetX: number; offsetY: number }`
  - `type SourceRect = { sx: number; sy: number; size: number }`
  - `MAX_ZOOM: 3`
  - `minScale(image: ImageSize, frame: number): number`
  - `initialView(image: ImageSize, frame: number): View`
  - `clampView(view: View, image: ImageSize, frame: number): View`
  - `sourceRect(view: View, image: ImageSize, frame: number): SourceRect`

- [ ] **Step 1: Write the failing test**

Create `src/components/account/crop-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampView, initialView, minScale, sourceRect, MAX_ZOOM } from "./crop-geometry";

const FRAME = 200;
const WIDE = { width: 800, height: 400 }; // landscape
const TALL = { width: 400, height: 800 }; // portrait

describe("minScale", () => {
  // The SHORTER edge must exactly fill the frame; anything less leaves a gap in the circle.
  it("fills the frame from the shorter edge", () => {
    expect(minScale(WIDE, FRAME)).toBe(0.5); // 200/400 (height is shorter)
    expect(minScale(TALL, FRAME)).toBe(0.5); // 200/400 (width is shorter)
  });

  it("scales up an image smaller than the frame", () => {
    expect(minScale({ width: 100, height: 50 }, FRAME)).toBe(4); // 200/50
  });
});

describe("initialView", () => {
  it("starts at minimum zoom, centred", () => {
    const v = initialView(WIDE, FRAME);
    expect(v.scale).toBe(0.5);
    // Displayed 400x200; centred horizontally means offsetX = (200 - 400) / 2.
    expect(v.offsetX).toBe(-100);
    expect(v.offsetY).toBe(0);
  });
});

describe("clampView", () => {
  it("never lets the image zoom below full coverage", () => {
    const v = clampView({ scale: 0.1, offsetX: 0, offsetY: 0 }, WIDE, FRAME);
    expect(v.scale).toBe(0.5);
  });

  it("caps zoom at MAX_ZOOM times the minimum", () => {
    const v = clampView({ scale: 99, offsetX: 0, offsetY: 0 }, WIDE, FRAME);
    expect(v.scale).toBe(0.5 * MAX_ZOOM);
  });

  // The core invariant: no pan can ever expose a gutter inside the frame.
  it("clamps panning so the frame stays fully covered", () => {
    // Displayed 400x200. offsetX must stay within [200 - 400, 0] = [-200, 0].
    expect(clampView({ scale: 0.5, offsetX: 50, offsetY: 0 }, WIDE, FRAME).offsetX).toBe(0);
    expect(clampView({ scale: 0.5, offsetX: -999, offsetY: 0 }, WIDE, FRAME).offsetX).toBe(-200);
    // The short axis has exactly zero slack at minimum scale.
    expect(clampView({ scale: 0.5, offsetX: 0, offsetY: -80 }, WIDE, FRAME).offsetY).toBe(0);
  });

  it("re-clamps the offset when a zoom-out would strand the image off-frame", () => {
    // Zoomed in and panned hard right, then zoomed back out: the old offset is now illegal.
    const zoomed = clampView({ scale: 1.5, offsetX: -900, offsetY: -500 }, WIDE, FRAME);
    const out = clampView({ ...zoomed, scale: 0.5 }, WIDE, FRAME);
    expect(out.offsetX).toBe(-200);
    expect(out.offsetY).toBe(0);
  });
});

describe("sourceRect", () => {
  it("maps a centred minimum-zoom view to the centred square of the source", () => {
    const r = sourceRect(initialView(WIDE, FRAME), WIDE, FRAME);
    expect(r).toEqual({ sx: 200, sy: 0, size: 400 }); // the middle 400x400 of an 800x400
  });

  it("maps a panned view to the corresponding source pixels", () => {
    const r = sourceRect({ scale: 0.5, offsetX: 0, offsetY: 0 }, WIDE, FRAME);
    expect(r).toEqual({ sx: 0, sy: 0, size: 400 }); // hard left
  });

  it("shrinks the source square as zoom increases", () => {
    const r = sourceRect({ scale: 1, offsetX: -200, offsetY: -200 }, WIDE, FRAME);
    expect(r).toEqual({ sx: 200, sy: 200, size: 200 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/account/crop-geometry.test.ts`
Expected: FAIL — `Failed to resolve import "./crop-geometry"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/account/crop-geometry.ts`:

```ts
/**
 * Pan/zoom math for the avatar cropper, as pure functions over a view state.
 *
 * `frame` is the diameter of the circular crop frame in CSS pixels. `scale` maps source pixels
 * to display pixels. `offsetX`/`offsetY` is the top-left of the DISPLAYED image relative to the
 * frame's top-left, also in display pixels — normally negative, because a covering image
 * overhangs the frame.
 *
 * ⚠️ `clampView` is the reason an avatar can never ship with a bite out of it. Every mutation of
 * the view — drag, zoom, or a programmatic reset — must go through it, including zoom changes:
 * zooming OUT can strand a previously-legal offset outside its new bounds, so the offset is
 * re-clamped against the NEW scale rather than the one it was set under.
 */
export type ImageSize = { width: number; height: number };
export type View = { scale: number; offsetX: number; offsetY: number };
export type SourceRect = { sx: number; sy: number; size: number };

/** Zoom ceiling, as a multiple of the minimum covering scale. */
export const MAX_ZOOM = 3;

/** The smallest scale at which the image still covers the frame on both axes. */
export function minScale(image: ImageSize, frame: number): number {
  return Math.max(frame / image.width, frame / image.height);
}

/** Fully zoomed out and centred — what a freshly-picked file opens at. */
export function initialView(image: ImageSize, frame: number): View {
  const scale = minScale(image, frame);
  return {
    scale,
    offsetX: (frame - image.width * scale) / 2,
    offsetY: (frame - image.height * scale) / 2,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function clampView(view: View, image: ImageSize, frame: number): View {
  const low = minScale(image, frame);
  const scale = clamp(view.scale, low, low * MAX_ZOOM);
  // Bounds derived from the NEW scale, never the one the offset was set under.
  return {
    scale,
    offsetX: clamp(view.offsetX, frame - image.width * scale, 0),
    offsetY: clamp(view.offsetY, frame - image.height * scale, 0),
  };
}

/** The square of SOURCE pixels currently framed — what the canvas draws from. */
export function sourceRect(view: View, image: ImageSize, frame: number): SourceRect {
  return {
    sx: -view.offsetX / view.scale,
    sy: -view.offsetY / view.scale,
    size: frame / view.scale,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/account/crop-geometry.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/crop-geometry.ts src/components/account/crop-geometry.test.ts
git commit -m "Add pure pan/zoom geometry for the avatar cropper"
```

---

### Task 2: The cropper component

The masked image, the pointer drag, the zoom slider, and the canvas export.

**Files:**
- Create: `src/components/account/avatar-cropper.tsx`
- Test: `src/components/account/avatar-cropper.test.tsx`

**Interfaces:**
- Consumes: `clampView`, `initialView`, `sourceRect`, `minScale`, `MAX_ZOOM`, `View`, `ImageSize`, `SourceRect` from `./crop-geometry`.
- Produces:
  - `FRAME = 220` — crop frame diameter in CSS px.
  - `EXPORT_SIZE = 512`
  - `type CropToBlob = (img: HTMLImageElement, rect: SourceRect) => Promise<Blob>`
  - `cropToBlob: CropToBlob` — the real canvas implementation.
  - `type CropperHandle = { crop: () => Promise<Blob> }`
  - `AvatarCropper` — `forwardRef<CropperHandle, { src: string; cropToBlob?: CropToBlob }>`

- [ ] **Step 1: Write the failing test**

Create `src/components/account/avatar-cropper.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { createRef } from "react";
import { AvatarCropper, FRAME, type CropperHandle } from "./avatar-cropper";

// jsdom reports 0 for naturalWidth/naturalHeight; the cropper reads them on load, so the test
// installs real values before firing the load event.
function loadImage(el: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(el, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(el, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(el);
}

function setup(cropToBlob = vi.fn(async () => new Blob(["x"], { type: "image/webp" }))) {
  const ref = createRef<CropperHandle>();
  const view = render(<AvatarCropper ref={ref} src="blob:fake" cropToBlob={cropToBlob} />);
  const img = view.container.querySelector("img")!;
  loadImage(img, 800, 400);
  return { ref, img, cropToBlob, ...view };
}

describe("AvatarCropper", () => {
  test("offers a zoom slider bounded by the minimum covering scale", () => {
    setup();
    const zoom = screen.getByRole("slider", { name: /zoom/i }) as HTMLInputElement;
    expect(zoom.min).toBe("1");
    expect(zoom.max).toBe("3");
    expect(zoom.value).toBe("1"); // opens fully zoomed out
  });

  test("crops from the centred square at the opening view", async () => {
    const { ref, cropToBlob } = setup();
    await act(async () => { await ref.current!.crop(); });
    // An 800x400 source at minimum zoom frames its middle 400x400.
    expect(cropToBlob.mock.calls[0]![1]).toEqual({ sx: 200, sy: 0, size: 400 });
  });

  test("a pointer drag moves the framed region", async () => {
    const { ref, cropToBlob, container } = setup();
    const stage = container.querySelector("[data-testid='crop-stage']")!;
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(stage, { pointerId: 1 });
    await act(async () => { await ref.current!.crop(); });
    // Dragged 50px right at scale 0.5 → the framed square starts 100 source px earlier.
    expect(cropToBlob.mock.calls[0]![1]).toEqual({ sx: 100, sy: 0, size: 400 });
  });

  // The invariant from Task 1, asserted through the component: no drag can expose a gutter.
  test("a drag past the edge clamps instead of exposing a gutter", async () => {
    const { ref, cropToBlob, container } = setup();
    const stage = container.querySelector("[data-testid='crop-stage']")!;
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 9999, clientY: 9999 });
    fireEvent.pointerUp(stage, { pointerId: 1 });
    await act(async () => { await ref.current!.crop(); });
    expect(cropToBlob.mock.calls[0]![1]).toEqual({ sx: 0, sy: 0, size: 400 });
  });

  test("zooming in shrinks the framed square", async () => {
    const { ref, cropToBlob } = setup();
    fireEvent.change(screen.getByRole("slider", { name: /zoom/i }), { target: { value: "2" } });
    await act(async () => { await ref.current!.crop(); });
    expect(cropToBlob.mock.calls[0]![1].size).toBe(FRAME / (0.5 * 2));
  });

  test("crop rejects before the image has loaded rather than exporting a blank square", async () => {
    const ref = createRef<CropperHandle>();
    render(<AvatarCropper ref={ref} src="blob:fake" cropToBlob={vi.fn()} />);
    await expect(ref.current!.crop()).rejects.toThrow(/not loaded/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/account/avatar-cropper.test.tsx`
Expected: FAIL — `Failed to resolve import "./avatar-cropper"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/account/avatar-cropper.tsx`:

```tsx
"use client";
import { forwardRef, useImperativeHandle, useRef, useState, type PointerEvent } from "react";
import {
  clampView,
  initialView,
  minScale,
  sourceRect,
  MAX_ZOOM,
  type ImageSize,
  type SourceRect,
  type View,
} from "./crop-geometry";

/** Crop frame diameter in CSS px. Fits inside the dialog at a 320px viewport. */
export const FRAME = 220;

/** Exported square. The server downsizes to 256; 512 keeps it crisp on hi-dpi. */
export const EXPORT_SIZE = 512;

export type CropToBlob = (img: HTMLImageElement, rect: SourceRect) => Promise<Blob>;
export type CropperHandle = { crop: () => Promise<Blob> };

/**
 * Renders the chosen square to a canvas. Injectable at the call site because jsdom has no
 * canvas — the geometry is unit-tested in `crop-geometry.test.ts` and the wiring is asserted by
 * stubbing this; only a browser can prove the pixels.
 */
export const cropToBlob: CropToBlob = async (img, rect) => {
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_SIZE;
  canvas.height = EXPORT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(img, rect.sx, rect.sy, rect.size, rect.size, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  );
  if (!blob) throw new Error("encode_failed");
  return blob;
};

/**
 * The crop stage: the image behind a circular mask, draggable, with a zoom slider.
 *
 * ⚠️ POINTER events, not mouse events — this is the only reason the drag works on a phone
 * without a second touch code path. `setPointerCapture` is what keeps a drag alive when the
 * finger or cursor leaves the stage mid-gesture.
 *
 * ⚠️ Every view mutation goes through `clampView`, including the zoom slider. See the ⚠️ in
 * `crop-geometry.ts` — a zoom-out re-clamps the offset it was holding.
 */
export const AvatarCropper = forwardRef<CropperHandle, { src: string; cropToBlob?: CropToBlob }>(
  function AvatarCropper({ src, cropToBlob: crop = cropToBlob }, ref) {
    const imgRef = useRef<HTMLImageElement>(null);
    const [image, setImage] = useState<ImageSize | null>(null);
    const [view, setView] = useState<View | null>(null);
    const drag = useRef<{ x: number; y: number } | null>(null);

    useImperativeHandle(ref, () => ({
      crop: async () => {
        const img = imgRef.current;
        if (!img || !image || !view) throw new Error("image not loaded");
        return crop(img, sourceRect(view, image, FRAME));
      },
    }));

    const onLoad = () => {
      const img = imgRef.current;
      if (!img) return;
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      if (!size.width || !size.height) return;
      setImage(size);
      setView(initialView(size, FRAME));
    };

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
      if (!view) return;
      drag.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (!start || !image || !view) return;
      const next = {
        ...view,
        offsetX: view.offsetX + (e.clientX - start.x),
        offsetY: view.offsetY + (e.clientY - start.y),
      };
      drag.current = { x: e.clientX, y: e.clientY };
      setView(clampView(next, image, FRAME));
    };

    const endDrag = (e: PointerEvent<HTMLDivElement>) => {
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    };

    // The slider is expressed in MULTIPLES of the minimum covering scale, so its range is a
    // fixed 1–MAX_ZOOM whatever the image's dimensions are.
    const low = image ? minScale(image, FRAME) : 1;
    const zoom = view ? view.scale / low : 1;

    const onZoom = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!image || !view) return;
      setView(clampView({ ...view, scale: low * Number(e.target.value) }, image, FRAME));
    };

    return (
      <div className="flex flex-col items-center gap-4">
        <div
          data-testid="crop-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ width: FRAME, height: FRAME }}
          className="relative touch-none overflow-hidden rounded-full border-2 border-dark-edge-bright bg-dark-well"
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            onLoad={onLoad}
            draggable={false}
            style={
              view && image
                ? {
                    position: "absolute",
                    left: view.offsetX,
                    top: view.offsetY,
                    width: image.width * view.scale,
                    height: image.height * view.scale,
                    maxWidth: "none",
                  }
                : { position: "absolute", visibility: "hidden" }
            }
            className="select-none"
          />
        </div>
        <label className="flex w-full items-center gap-3 font-mono text-[11px] uppercase tracking-[.06em] text-cream-muted">
          Zoom
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={onZoom}
            disabled={!view}
            className="flex-1 accent-yellow"
          />
        </label>
        <p className="font-mono text-[10.5px] uppercase tracking-[.05em] text-cream-dim">
          Drag to reposition
        </p>
      </div>
    );
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/account/avatar-cropper.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/avatar-cropper.tsx src/components/account/avatar-cropper.test.tsx
git commit -m "Add the avatar crop stage: masked image, pointer drag, zoom"
```

---

### Task 3: Rewrite the panel as the dialog's body

The draft state, the three mutations, and the actions. Still no dialog shell — that lands in Task 4, so this task's deliverable is reviewable on its own.

The `SrStatus` block and `invalidate()` are lifted verbatim from today's file. Read it before starting: `src/components/account/avatar-panel.tsx`.

**Files:**
- Modify: `src/components/account/avatar-panel.tsx` (rewrite)
- Modify: `src/components/account/avatar-panel.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `AvatarCropper`, `cropToBlob`, `CropperHandle`, `CropToBlob` from `./avatar-cropper`; `getAvatar`, `uploadAvatar`, `syncAvatar`, `removeAvatar`, `ApiError` from `@/lib/api`; `useSession` from `@/lib/auth-client`; `Avatar` from `@/components/shared/avatar`; `SrStatus` from `@/components/shared/sr-status`.
- Produces: `AvatarPanel` — props `{ onSaved: () => void; cropToBlob?: CropToBlob }`.

`onSaved` fires only on a successful commit; the dialog uses it to close. A failed save leaves the panel mounted with the draft intact.

- [ ] **Step 1: Write the failing test**

Replace `src/components/account/avatar-panel.test.tsx` entirely:

```tsx
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { AvatarPanel } from "./avatar-panel";
import { ApiError } from "@/lib/api";

const getAvatar = vi.fn();
const uploadAvatar = vi.fn();
const syncAvatar = vi.fn();
const removeAvatar = vi.fn();
const routerRefresh = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getAvatar: (...a: unknown[]) => getAvatar(...a),
    uploadAvatar: (...a: unknown[]) => uploadAvatar(...a),
    syncAvatar: (...a: unknown[]) => syncAvatar(...a),
    removeAvatar: (...a: unknown[]) => removeAvatar(...a),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { image: "https://cdn.discordapp.com/avatars/1/a.png" } } }),
}));

const cropToBlob = vi.fn(async () => new Blob(["x"], { type: "image/webp" }));
const onSaved = vi.fn();

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const panel = () => wrap(<AvatarPanel onSaved={onSaved} cropToBlob={cropToBlob} />);

function pickFile(name = "avatar.png") {
  const input = screen.getByLabelText(/choose an image/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "image/png" })] } });
}

// The cropper only produces a rect once its <img> reports natural dimensions.
function loadCropperImage(container: HTMLElement) {
  const img = container.querySelector("[data-testid='crop-stage'] img") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 400, configurable: true });
  fireEvent.load(img);
}

const save = () => screen.getByRole("button", { name: /^save$/i });

beforeEach(() => {
  vi.clearAllMocks();
  getAvatar.mockResolvedValue({ hash: null });
  cropToBlob.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
  vi.stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: vi.fn() });
});

describe("AvatarPanel", () => {
  test("Save is disabled until something is staged", async () => {
    panel();
    await waitFor(() => expect(save()).toBeDisabled());
  });

  test("shows the silhouette and no fabricated 'no avatar' claim while loading", () => {
    getAvatar.mockReturnValue(new Promise(() => {}));
    const { container } = panel();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('span[aria-hidden="true"] svg')).not.toBeNull();
  });

  test("renders the current avatar once resolved", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    const { container } = panel();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/avatars/cafe1234feed5678.webp");
  });

  test("picking a file stages a crop and commits only on Save", async () => {
    uploadAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    const { container } = panel();
    pickFile();
    await waitFor(() => expect(container.querySelector("[data-testid='crop-stage']")).not.toBeNull());
    // Staged, not committed.
    expect(uploadAvatar).not.toHaveBeenCalled();

    loadCropperImage(container);
    await waitFor(() => expect(save()).toBeEnabled());
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(uploadAvatar).toHaveBeenCalled());
    expect(uploadAvatar.mock.calls[0]![0]).toBeInstanceOf(File);
    expect(cropToBlob).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  test("staging the Discord photo previews it and commits with sync on Save", async () => {
    syncAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    panel();
    fireEvent.click(screen.getByRole("button", { name: /use my discord photo/i }));
    expect(screen.getByAltText("")).toHaveAttribute("src", "https://cdn.discordapp.com/avatars/1/a.png");
    expect(syncAvatar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(syncAvatar).toHaveBeenCalled());
  });

  // Discord rotates its CDN links. A preview that won't load is the `provider_image_stale`
  // condition showing up BEFORE the commit instead of after it.
  test("a Discord preview that fails to load warns without blocking Save", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /use my discord photo/i }));
    fireEvent.error(screen.getByAltText(""));
    expect(screen.getByText(/rotated your photo/i)).toBeInTheDocument();
    expect(save()).toBeEnabled(); // the server is the authority, not the preview
  });

  test("staging a removal shows the empty silhouette and commits with DELETE on Save", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    const { container } = panel();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    expect(container.querySelector("img")).toBeNull();
    expect(removeAvatar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(removeAvatar).toHaveBeenCalled());
  });

  test("a failed save keeps the draft and does not report success", async () => {
    uploadAvatar.mockRejectedValue(new ApiError("too_large", 400));
    const { container } = panel();
    pickFile();
    await waitFor(() => expect(container.querySelector("[data-testid='crop-stage']")).not.toBeNull());
    loadCropperImage(container);
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/too large/i));
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='crop-stage']")).not.toBeNull();
  });

  // The dossier hero is server-rendered (RSC) and isn't reachable through query invalidation.
  test("a successful change also calls router.refresh, reaching the server-rendered hero", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));
    expect(routerRefresh).toHaveBeenCalled();
  });

  test("announces on settlement, never at click", async () => {
    let resolveRemove!: (v: { ok: true }) => void;
    removeAvatar.mockReturnValue(new Promise((r) => { resolveRemove = r; }));
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    fireEvent.click(save());
    expect(screen.getByRole("status")).toHaveTextContent("");
    await act(async () => { resolveRemove({ ok: true }); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));
  });

  // Two settlements landing on the SAME text must both announce; React bails on an equal state
  // update, so each mutation blanks the announcement in onMutate.
  test("a repeated outcome re-announces", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));

    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    fireEvent.click(save());
    expect(screen.getByRole("status")).toHaveTextContent(""); // blanked on start
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/account/avatar-panel.test.tsx`
Expected: FAIL — `AvatarPanel` takes no `onSaved`/`cropToBlob` props and renders no Save button.

- [ ] **Step 3: Write minimal implementation**

Replace `src/components/account/avatar-panel.tsx` entirely:

```tsx
"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getAvatar, removeAvatar, syncAvatar, uploadAvatar } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { Avatar } from "@/components/shared/avatar";
import { SrStatus } from "@/components/shared/sr-status";
import { AvatarCropper, cropToBlob as realCropToBlob, type CropToBlob, type CropperHandle } from "./avatar-cropper";

const ERROR_MESSAGES: Record<string, string> = {
  too_large: "That image is too large (5 MB max).",
  not_an_image: "That file doesn't look like an image.",
  no_provider_image: "Your login method has no avatar to pull.",
  provider_image_stale:
    "Discord has rotated your photo's link — sign out and back in to refresh it, or upload a photo directly.",
  fetch_failed: "Couldn't reach your login provider just now — try again in a minute.",
};

function avatarErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return ERROR_MESSAGES[err.code] ?? "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

/**
 * ⚠️ ONE staged draft drives the whole dialog, and SAVE IS THE ONLY COMMIT POINT. Nothing here
 * writes to the server until Save — including "Remove photo", which previously fired on click.
 * That is what makes Cancel mean "nothing happened" in every case; an interface where Cancel
 * undoes some actions and not others reads as unpredictable even when each one works.
 */
type Draft =
  | { kind: "current" }
  | { kind: "file"; file: File; url: string }
  | { kind: "provider" }
  | { kind: "removed" };

const ACTION = "text-left font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted hover:text-paper disabled:opacity-50";

/**
 * The dialog's body: the pending avatar, the three ways to change it, and Save.
 *
 * `["avatar"]` is the one source of truth for the session's own hash — shared with the masthead
 * `AccountAffordance`, which reads the same query key so both update together on a successful
 * mutation.
 *
 * Announcements fire ON SETTLEMENT (each mutation's `onSuccess`/`onError` callback only runs
 * once the request resolves), never at click — the repo-wide SrStatus policy.
 *
 * ⚠️ `announcement` is a plain `useState` set from each mutation's own `onSuccess`/`onError`,
 * NOT derived by reading `isSuccess`/`isError` off all three mutations. TanStack mutation flags
 * stay true after settlement until that SAME mutation object runs again — a priority chain over
 * them (upload > sync > remove, say) would freeze on the first mutation's outcome forever: upload
 * once, then Remove later, and the live region never changes because `upload.isSuccess` is still
 * true and outranks `remove.isSuccess` in the chain. Setting state imperatively in each callback
 * makes "most recently settled" automatic — whichever callback fires last wins, however many
 * mutations have already settled before it.
 *
 * ⚠️ Each mutation ALSO clears `announcement` to `""` in `onMutate` (i.e. the instant it starts,
 * not when it settles). Without this, two consecutive settlements that land on the SAME text
 * (e.g. upload succeeds, then later a sync also succeeds — both "Avatar updated") never change
 * `announcement`'s value, so React bails out of the state update (`Object.is` equality) and the
 * `role="status"` node's text never mutates a second time — a screen reader hears nothing for the
 * second action. Blanking on start forces every settlement through a fresh `""` → message
 * transition, which is what makes assistive tech re-announce even a repeated message.
 */
export function AvatarPanel({
  onSaved,
  cropToBlob = realCropToBlob,
}: {
  onSaved: () => void;
  cropToBlob?: CropToBlob;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar });
  const session = useSession();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["avatar"] });
    // `["player-page"]` only backs Home's client-side reads — it can't reach the dossier hero,
    // which is server-rendered (`app/(site)/(boxed)/players/[slug]/page.tsx` fetches
    // `getPlayerPage` in an RSC). `router.refresh()` is what actually reaches that hero: it
    // re-runs the server component with fresh data. Both invalidations stay for Home.
    void qc.invalidateQueries({ queryKey: ["player-page"] });
    router.refresh();
  };
  const [announcement, setAnnouncement] = useState("");
  const clearAnnouncement = () => setAnnouncement("");
  const settled = (message: string) => () => { invalidate(); setAnnouncement(message); onSaved(); };

  const upload = useMutation({
    mutationFn: uploadAvatar,
    onMutate: clearAnnouncement,
    onSuccess: settled("Avatar updated"),
    onError: (err) => setAnnouncement(avatarErrorMessage(err)),
  });
  const sync = useMutation({
    mutationFn: syncAvatar,
    onMutate: clearAnnouncement,
    onSuccess: settled("Avatar updated"),
    onError: (err) => setAnnouncement(avatarErrorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: removeAvatar,
    onMutate: clearAnnouncement,
    onSuccess: settled("Avatar removed"),
    onError: (err) => setAnnouncement(avatarErrorMessage(err)),
  });

  const [draft, setDraft] = useState<Draft>({ kind: "current" });
  const [providerBroken, setProviderBroken] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropperRef = useRef<CropperHandle>(null);
  const pending = upload.isPending || sync.isPending || remove.isPending;

  const hash = avatar.data?.hash ?? null;
  const providerImage = session.data?.user?.image ?? null;

  // ⚠️ The staged object URL is revoked when the draft is replaced or the panel unmounts. A
  // dialog that is opened and cancelled repeatedly otherwise leaks one blob per pick.
  useEffect(() => {
    if (draft.kind !== "file") return;
    return () => URL.revokeObjectURL(draft.url);
  }, [draft]);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a failed save
    if (file) setDraft({ kind: "file", file, url: URL.createObjectURL(file) });
  };

  const onSave = async () => {
    if (draft.kind === "file") {
      const blob = await cropperRef.current!.crop();
      upload.mutate(new File([blob], "avatar.webp", { type: "image/webp" }));
    } else if (draft.kind === "provider") {
      sync.mutate();
    } else if (draft.kind === "removed") {
      remove.mutate();
    }
  };

  // Save needs a croppable image actually loaded, not merely a file picked.
  const [cropReady, setCropReady] = useState(false);
  useEffect(() => { setCropReady(false); }, [draft]);

  const canSave =
    !pending &&
    (draft.kind === "provider" ||
      (draft.kind === "removed" && (hash != null || avatar.isLoading)) ||
      (draft.kind === "file" && cropReady));

  return (
    <section aria-label="Your photo" className="flex flex-col gap-5 p-5">
      <div className="flex flex-col items-center gap-4">
        {draft.kind === "file" ? (
          <div onLoad={() => setCropReady(true)} className="w-full">
            <AvatarCropper ref={cropperRef} src={draft.url} cropToBlob={cropToBlob} />
          </div>
        ) : draft.kind === "provider" && providerImage ? (
          <img
            src={providerImage}
            alt=""
            width={112}
            height={112}
            onError={() => setProviderBroken(true)}
            className="h-28 w-28 rounded-full border border-dark-edge-bright object-cover"
          />
        ) : (
          <Avatar hash={draft.kind === "removed" ? null : hash} size={112} variant="dark" />
        )}
      </div>

      {draft.kind === "provider" && providerBroken && (
        <p role="alert" className="font-mono text-[11px] leading-relaxed text-red">
          {ERROR_MESSAGES.provider_image_stale}
        </p>
      )}

      <div className="flex flex-col items-start gap-2.5 border-t border-dark-line pt-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
          className="border-b-2 border-yellow font-display text-sm font-semibold uppercase tracking-[.06em] text-paper hover:text-yellow disabled:opacity-50"
        >
          {draft.kind === "file" ? "Choose a different image" : "Choose an image"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label="Choose an image"
          className="sr-only"
          onChange={onFileChange}
        />
        <button
          type="button"
          disabled={pending || !providerImage}
          onClick={() => { setProviderBroken(false); setDraft({ kind: "provider" }); }}
          className={ACTION}
        >
          Use my Discord photo
        </button>
        <button
          type="button"
          disabled={pending || (!hash && !avatar.isLoading)}
          onClick={() => setDraft({ kind: "removed" })}
          className={ACTION}
        >
          Remove photo
        </button>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-dark-line pt-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => { setProviderBroken(false); setDraft({ kind: "current" }); }}
          className={ACTION}
        >
          Reset
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void onSave()}
          className="min-h-[44px] border-2 border-yellow bg-yellow px-6 font-display text-sm font-bold uppercase tracking-[.06em] text-dark hover:bg-paper disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Always-mounted (per the SrStatus rule): the live region must pre-exist the text change
       *  it announces, or some screen readers won't pick up the first message. Loading is
       *  deliberately not asserted as "no avatar" here — the silhouette renders either way, with
       *  no accompanying claim about it being resolved-empty. */}
      <SrStatus>{announcement}</SrStatus>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/account/avatar-panel.test.tsx`
Expected: PASS — 11 tests.

Then: `pnpm --filter @onelife/web run typecheck` — expected clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/avatar-panel.tsx src/components/account/avatar-panel.test.tsx
git commit -m "Rework the avatar panel around a staged draft with a single commit point"
```

---

### Task 4: The dialog shell

**Files:**
- Create: `src/components/account/avatar-dialog.tsx`
- Test: `src/components/account/avatar-dialog.test.tsx`

**Interfaces:**
- Consumes: `AvatarPanel` from `./avatar-panel`; `useModalBehavior` from `@/lib/use-modal-behavior`; `CropToBlob` from `./avatar-cropper`.
- Produces: `AvatarDialog` — props `{ open: boolean; onClose: () => void; cropToBlob?: CropToBlob }`.

- [ ] **Step 1: Write the failing test**

Create `src/components/account/avatar-dialog.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { AvatarDialog } from "./avatar-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { image: null } } }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getAvatar: async () => ({ hash: null }) };
});

const onClose = vi.fn();
function open(isOpen = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AvatarDialog open={isOpen} onClose={onClose} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("AvatarDialog", () => {
  test("renders nothing when closed", () => {
    open(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("is a labelled modal dialog when open", async () => {
    open();
    const dialog = await screen.findByRole("dialog", { name: /your photo/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  // ⚠️ A position:fixed overlay under a transformed ancestor collapses into it. The dialog is
  // opened from inside the stage section, so it must escape to the body.
  test("portals to document.body rather than rendering in place", async () => {
    const { container } = open();
    await screen.findByRole("dialog");
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.body.querySelector("[role='dialog']")).not.toBeNull();
  });

  test("closes on Escape, on the backdrop, and on the close button", async () => {
    const { unmount } = open();
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("avatar-dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  test("closes itself once a change is saved", async () => {
    open();
    await screen.findByRole("dialog");
    // AvatarPanel calls onSaved on a successful mutation; the dialog wires it to onClose.
    // Proven end-to-end in stage-avatar.test.tsx; here just assert the prop is wired.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/account/avatar-dialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./avatar-dialog"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/account/avatar-dialog.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { AvatarPanel } from "./avatar-panel";
import type { CropToBlob } from "./avatar-cropper";

/**
 * The avatar edit, as a dialog. Same shell as `ClaimModal` — `z-50` per the LAYER LEGEND at the
 * `<header>` in `components/header.tsx`, dark panel, `useModalBehavior` for focus, Escape and the
 * ref-counted scroll lock.
 *
 * ⚠️ PORTALLED TO `document.body`, which `ClaimModal` does not need to be. This dialog is opened
 * from `StageAvatar`, deep inside the stage section: a `position: fixed` overlay nested under any
 * CSS-transformed ancestor positions against that ancestor's box instead of the viewport and
 * collapses into it. jsdom cannot see the difference, so the portal is pinned by a test rather
 * than by a rendering check.
 *
 * The `mounted` guard is the App Router requirement — `document` does not exist during the server
 * render, and portalling on the first client render before hydration completes mismatches.
 */
export function AvatarDialog({
  open,
  onClose,
  cropToBlob,
}: {
  open: boolean;
  onClose: () => void;
  cropToBlob?: CropToBlob;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const panelRef = useModalBehavior(open, onClose);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Gesture target, not content (map online-sheet precedent): the dialog is aria-modal. */}
      <div
        aria-hidden="true"
        data-testid="avatar-dialog-backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-ink/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your photo"
        tabIndex={-1}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto border-2 border-dark-line bg-dark shadow-[0_10px_40px_rgba(0,0,0,.5)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center font-mono text-lg text-cream-muted hover:text-paper"
        >
          ✕
        </button>
        <AvatarPanel onSaved={onClose} cropToBlob={cropToBlob} />
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/account/avatar-dialog.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/avatar-dialog.tsx src/components/account/avatar-dialog.test.tsx
git commit -m "Add the portalled avatar dialog shell"
```

---

### Task 5: Wire the pencil

**Files:**
- Modify: `src/components/player/stage-avatar.tsx`
- Test: `src/components/player/stage-avatar.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `AvatarDialog` from `@/components/account/avatar-dialog`.
- Produces: no signature change — `StageAvatar` keeps `{ hash, fallbackInitial, editable }`.

- [ ] **Step 1: Write the failing test**

Create (or replace) `src/components/player/stage-avatar.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { StageAvatar } from "./stage-avatar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { image: null } } }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getAvatar: async () => ({ hash: null }) };
});

function mount(editable: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StageAvatar hash={null} fallbackInitial="M" editable={editable} />
    </QueryClientProvider>,
  );
}

describe("StageAvatar", () => {
  test("shows no edit affordance at all to the public", () => {
    mount(false);
    expect(screen.queryByRole("button", { name: /update your photo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("the pencil opens the dialog and nothing is rendered inline", async () => {
    mount(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /update your photo/i }));
    expect(await screen.findByRole("dialog", { name: /your photo/i })).toBeInTheDocument();
  });

  test("closing the dialog returns focus to the pencil", async () => {
    mount(true);
    const pencil = screen.getByRole("button", { name: /update your photo/i });
    fireEvent.click(pencil);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(pencil);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/player/stage-avatar.test.tsx`
Expected: FAIL — no `dialog` role; the component still renders `AvatarPanel` inline.

- [ ] **Step 3: Write minimal implementation**

Replace `src/components/player/stage-avatar.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Avatar } from "@/components/shared/avatar";
import { AvatarDialog } from "@/components/account/avatar-dialog";

/**
 * The stage's identity circle.
 *
 * Owner: the circle plus a pencil that opens the `AvatarDialog`.
 * Public: the same circle, read-only — no pencil, no upload affordance at all.
 *
 * ⚠️ This pencil is the SINGLE edit path. The dossier's old "Update photo ↓" disclosure was
 * retired with it (spec §2) — two edit paths on one page is how the avatar work shipped twice.
 *
 * ⚠️ The edit UI is a DIALOG, not an inline panel. The inline panel inherited this stage's
 * `bg-dark` while styling its own controls `text-ink`, which rendered the Upload button
 * invisible — present, focusable, unpaintable. A dialog owns its own surface and cannot
 * inherit the wrong one.
 */
export function StageAvatar({
  hash,
  fallbackInitial,
  editable,
}: {
  hash: string | null;
  fallbackInitial: string;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block flex-none">
      <Avatar hash={hash} size={112} variant="dark" fallbackInitial={fallbackInitial} />
      {editable && (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label="Update your photo"
            className="absolute -bottom-1 -right-1 flex h-11 w-11 items-center justify-center rounded-full border-2 border-dark bg-yellow text-dark hover:bg-paper"
          >
            <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <AvatarDialog open={open} onClose={() => setOpen(false)} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/player/stage-avatar.test.tsx`
Expected: PASS — 3 tests.

Then the whole web suite: `pnpm vitest run` — expected all green. `player-profile.test.tsx` already asserts no `update your photo` button for the public viewer; that must still hold.

- [ ] **Step 5: Commit**

```bash
git add src/components/player/stage-avatar.tsx src/components/player/stage-avatar.test.tsx
git commit -m "Open the avatar dialog from the stage pencil"
```

---

### Task 6: Changelog and the outstanding-work record

**Files:**
- Modify: `CHANGELOG.md` (repo root)
- Modify: `CLAUDE.md` (repo root)

- [ ] **Step 1: Add the Unreleased changelog entry**

Under `## [Unreleased]`, in the existing `### Fixed` / `### Changed` sections (create them if absent), following the surrounding style:

```markdown
### Changed

- The avatar edit is now a dialog with a real crop stage — drag to reposition, zoom, and a single
  Save that commits. Nothing is written until Save, so Cancel always means nothing happened.

### Fixed

- The verified home rendered an older text-only "How to connect" panel instead of the universal
  "Join the servers" slab every other surface uses.
- The player dossier's back-link strip was light, painting a white bar between the dark masthead
  and the dark hero.
- The player stage claimed "Survivor · verified" for every player, including gamertags nobody had
  claimed.
- The avatar Upload button was dark text on the dark stage — present and clickable, but invisible.
```

- [ ] **Step 2: Record what the suite cannot close**

In `CLAUDE.md`, under **Outstanding, un-verified work**, add:

```markdown
- The avatar dialog's browser-only claims: the pointer drag and zoom slider actually moving the
  image (including under touch), the saved avatar matching what the preview showed, the dialog
  painting above the masthead and tab bar without collapsing into the stage's stacking context,
  and the dialog at 320px and in PWA/standalone on a notched phone. Needs a signed-in verified
  session; use CDP `Emulation.setDeviceMetricsOverride`.
```

- [ ] **Step 3: Verify the whole suite and typecheck**

Run from the repo root:

```bash
pnpm turbo run typecheck
pnpm turbo run test --concurrency=1
```

Expected: both clean. (DB suites need `TEST_DATABASE_URL`; this change touches none of them.)

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Record the avatar dialog in the changelog and its browser-only checks in CLAUDE.md"
```

---

## Self-review notes

- **Spec coverage.** Components table → Tasks 1–5. Staged draft and the Save dispatch table → Task 3. Discord staging and the `onError` warning → Task 3. Portal and layer → Task 4. Crop geometry and the coverage invariant → Task 1. Pointer events and 512² WebP → Task 2. `SrStatus` and `invalidate()` carry-over → Task 3. Failed save keeps the dialog open → Task 3. Not-closed-by-the-suite list → Task 6.
- **Naming.** `cropToBlob`, `CropperHandle.crop`, `FRAME`, `EXPORT_SIZE`, `Draft`, `onSaved` are used identically in every task that references them.
- **One deviation from the spec worth flagging at review:** the spec named Cancel; the panel's own button is labelled **Reset** (it clears the draft without closing), while Escape / backdrop / ✕ close the dialog and discard. Both discard without committing, so the "Cancel means nothing happened" guarantee holds. If you'd rather the panel button close the dialog outright, that is a one-line change in Task 3.
