import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processAvatarImage, AvatarImageError, AVATAR_MAX_BYTES } from "../src/lib/avatar-image.js";

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#803020" } }).png().toBuffer();

describe("processAvatarImage", () => {
  it("emits a 256×256 webp with a 16-hex hash, whatever the input shape", async () => {
    const out = await processAvatarImage(await png(1000, 400));
    const meta = await sharp(out.image).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([256, 256, "webp"]);
    expect(out.hash).toMatch(/^[0-9a-f]{16}$/);
  });
  it("is deterministic: same input, same hash", async () => {
    const buf = await png(300, 300);
    expect((await processAvatarImage(buf)).hash).toBe((await processAvatarImage(buf)).hash);
  });
  it("rejects oversize input before decoding", async () => {
    const big = Buffer.alloc(AVATAR_MAX_BYTES + 1);
    await expect(processAvatarImage(big)).rejects.toMatchObject({ code: "too_large" });
  });
  it("rejects non-image bytes", async () => {
    await expect(processAvatarImage(Buffer.from("not an image"))).rejects.toMatchObject({ code: "not_an_image" });
  });
  it("rejects svg (scripting surface)", async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>`);
    await expect(processAvatarImage(svg)).rejects.toMatchObject({ code: "not_an_image" });
  });
});
