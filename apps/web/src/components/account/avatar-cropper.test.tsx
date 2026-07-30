import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { createRef } from "react";
import { AvatarCropper, FRAME, type CropperHandle, type CropToBlob } from "./avatar-cropper";

// jsdom reports 0 for naturalWidth/naturalHeight; the cropper reads them on load, so the test
// installs real values before firing the load event.
function loadImage(el: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(el, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(el, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(el);
}

function setup(
  cropToBlob: CropToBlob & ReturnType<typeof vi.fn> = vi.fn(
    async () => new Blob(["x"], { type: "image/webp" }),
  ),
) {
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
