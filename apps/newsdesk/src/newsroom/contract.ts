import { z } from "zod";
import { EDITORIAL_PREFIXES } from "@onelife/read-models";
import { lintProse } from "./lint.js";

export class ContractError extends Error {}

const block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("para"), text: z.string().min(1) }),
  z.object({ type: z.literal("subhead"), text: z.string().min(1) }),
  z.object({ type: z.literal("quote"), text: z.string().min(1), attribution: z.string().optional() }),
  z.object({ type: z.literal("list"), items: z.array(z.string().min(1)).min(1).max(20) }),
]);
export type ArticleBlock = z.infer<typeof block>;

const schema = z.object({
  format: z.string().regex(/^[a-z][a-z0-9-]*$/, "format must be lowercase kebab-case"),
  naturalKey: z.string().min(1),
  headline: z.string().min(1).max(90),
  lede: z.string().min(1),
  blocks: z.array(block).min(1, "blocks must contain at least one block").max(40),
  pullQuote: z.object({ text: z.string().min(1), attribution: z.string().min(1) }).nullish(),
  tags: z.array(z.string().min(1)).max(2).default([]),
  // REQUIRED. See the test — provenance is the editorial desk's parity with the automated desks.
  factCheck: z.array(z.object({ claim: z.string().min(1), source: z.string().min(1) }))
    .min(1, "factCheck must have at least one claim→source row"),
  subjects: z.array(z.object({
    gamertag: z.string().min(1),
    mapSlug: z.string().nullish(),
    lifeNumber: z.number().int().positive().nullish(),
  })).default([]),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
});

export type EditorialPayload = z.infer<typeof schema>;

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Deterministic, format-prefixed, `[a-z0-9-]+` so the media route serves its hero unchanged.
 *  The natural key's tail disambiguates two articles that share a headline. */
export function editorialSlug(format: string, headline: string, naturalKey: string): string {
  const h = slugify(headline).slice(0, 60).replace(/-+$/g, "") || "dispatch";
  const tail = slugify(naturalKey.split(":").slice(1).join("-")).slice(0, 24).replace(/-+$/g, "");
  return [slugify(format), h, tail].filter(Boolean).join("-");
}

/** Flat `body` is DERIVED, never authored — the OG card and meta description read it, so they
 *  can never quote a sentence that is not on the page. Mirrors newsTick's rule exactly. */
export function flattenBlocks(blocks: ArticleBlock[]): string {
  return blocks.filter((b): b is Extract<ArticleBlock, { type: "para" }> => b.type === "para")
    .map((b) => b.text).join("\n\n");
}

export function parsePayload(raw: unknown): EditorialPayload {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ContractError(parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; "));
  }
  const p = parsed.data;

  if (!EDITORIAL_PREFIXES.some((prefix) => p.naturalKey.startsWith(prefix))) {
    throw new ContractError(
      `natural key must start with one of ${EDITORIAL_PREFIXES.join(", ")} — got "${p.naturalKey}". ` +
      `standing_dead:/long_form: belong to the automated triggers.`);
  }

  let prose = [p.headline, p.lede, ...p.blocks.flatMap((b) => b.type === "list" ? b.items : [b.text]),
    p.pullQuote?.text ?? ""].join("\n");
  // A DECLARED subject's gamertag is data, not shouting — mask it (verbatim casing only) before
  // the lint so an all-caps callsign like RAYGUN doesn't trip the ALL-CAPS rule. Undeclared
  // all-caps prose still fails: the exemption is scoped to the payload's own subjects list.
  for (const s of p.subjects) prose = prose.split(s.gamertag).join("Subject");
  const hits = lintProse(prose);
  if (hits.length) throw new ContractError(`brand voice: ${hits.join("; ")}`);

  return p;
}
