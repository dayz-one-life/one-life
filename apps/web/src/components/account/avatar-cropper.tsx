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
export const FRAME = 200;

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
      // ⚠️ jsdom has no setPointerCapture — guard so the test environment doesn't throw. Real
      // browsers always implement it; this is a defensive no-op there, not a fallback path.
      e.currentTarget.setPointerCapture?.(e.pointerId);
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
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
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
