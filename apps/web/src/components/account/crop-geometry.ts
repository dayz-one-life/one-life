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
    sx: (-view.offsetX / view.scale) + 0,
    sy: (-view.offsetY / view.scale) + 0,
    size: frame / view.scale,
  };
}
