// Vendored VERBATIM from ../brand/content-engine/image_prompt.py (source of truth:
// ../brand/brand-bible.md §10.4). Do not edit the two constants here — change the brand repo
// first, then re-vendor. R5c writes only "hero"; card/breaking are reserved for later verticals.

export const IMAGE_STYLE =
  "Shot on a cheap 1990s point-and-shoot film camera with direct on-camera flash: harsh flat " +
  "frontal flash, blown-out highlights, hard black shadows, heavy film grain, slight motion blur, " +
  "candid and unposed, awkward off-center crop, authentic amateur tabloid photojournalism, gritty " +
  "weathered realistic textures, damp overcast Eastern-European wilderness. Photorealistic, " +
  "imperfect, real.";

export const IMAGE_ANTISLOP =
  "It must NOT look like: a video game, a 3D render, CGI, an illustration, digital art, concept " +
  "art, a movie still, cinematic or dramatic studio lighting, HDR, bokeh, smooth airbrushed skin, " +
  "glamorous, beautiful, symmetrical, hyperdetailed, or professionally composed.";

export type ImageKind = "hero" | "card" | "breaking";

export const IMAGE_ASPECT: Record<ImageKind, string> = { hero: "16:9", card: "1:1", breaking: "16:9" };

/** §10.4 scaffold: [scene] + STYLE + ANTISLOP + pinned aspect. The aspect line is a composition
 *  nudge only — gpt-image models return a square canvas regardless; 16:9 is a render-side crop. */
export function buildImagePrompt(scene: string, kind: ImageKind = "hero"): string {
  const ratio = IMAGE_ASPECT[kind];
  if (!ratio) throw new Error(`unknown image kind: ${kind}`);
  return `${scene}\n\n${IMAGE_STYLE}\n\n${IMAGE_ANTISLOP}\n\nAspect ratio ${ratio}.`;
}
