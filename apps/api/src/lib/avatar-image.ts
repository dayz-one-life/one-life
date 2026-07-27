import sharp from "sharp";
import { createHash } from "node:crypto";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_SIZE = 256;

export class AvatarImageError extends Error {
  constructor(public code: "too_large" | "not_an_image") { super(code); }
}

/** One pipeline for uploads AND provider mirrors: cap → decode (never svg) →
 *  cover-crop 256×256 → webp q80 (re-encode drops EXIF) → content hash. */
export async function processAvatarImage(input: Buffer): Promise<{ image: Buffer; hash: string }> {
  if (input.byteLength > AVATAR_MAX_BYTES) throw new AvatarImageError("too_large");
  let image: Buffer;
  try {
    const s = sharp(input, { limitInputPixels: 8192 * 8192 });
    const meta = await s.metadata();
    if (!meta.format || meta.format === "svg") throw new Error("svg");
    image = await s.resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new AvatarImageError("not_an_image");
  }
  return { image, hash: createHash("sha256").update(image).digest("hex").slice(0, 16) };
}
