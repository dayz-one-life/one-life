import Image from "next/image";

/** Caption-rule accent per desk. Literal class strings (not interpolated) so Tailwind's JIT
 *  scanner sees them — the same idiom as the Kicker component's `colors` map.
 *  Morgue = red, Nursery = blue, Newsroom = ink: yellow already means beef, and on a news
 *  feature the photograph should carry the page rather than compete with a coloured rule. */
const ACCENT_BORDER = { red: "border-red", blue: "border-blue", ink: "border-ink" } as const;

export type ArticleHeroAccent = keyof typeof ACCENT_BORDER;

/** The generated tabloid photo atop an article interior. 16:9 render-side crop at the full
 *  article-column width; next/image handles resizing/webp. Pre-16:9 rows stored portrait
 *  canvases — object-cover takes their middle band, so no regeneration is required. alt is empty
 *  by convention — the visible caption is the accessible text. As of R5d PR-C3 the only kind
 *  that renders one is `news`. */
export function ArticleHero({ src, caption, accent }: {
  src: string;
  caption: string | null;
  accent: ArticleHeroAccent;
}) {
  return (
    <figure className="my-6">
      <div className="relative aspect-video w-full overflow-hidden border border-hairline">
        <Image src={src} alt="" fill sizes="(min-width: 768px) 768px, 100vw" className="object-cover" />
      </div>
      {caption ? (
        <figcaption className={`mt-2 border-l-[3px] pl-2 font-mono text-[11px] uppercase tracking-[.14em] text-ink-muted ${ACCENT_BORDER[accent]}`}>
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
