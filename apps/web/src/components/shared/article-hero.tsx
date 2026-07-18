import Image from "next/image";

/** The generated tabloid photo atop an article interior. 4:5 render-side crop of the (square)
 *  source; next/image handles resizing/webp. alt is empty by convention — the visible caption is
 *  the accessible text. */
export function ArticleHero({ src, caption, accent }: {
  src: string;
  caption: string | null;
  accent: "red" | "blue";
}) {
  return (
    <figure className="my-6">
      <div className="relative aspect-[4/5] w-full max-w-md overflow-hidden border border-hairline">
        <Image src={src} alt="" fill sizes="(min-width: 768px) 448px, 100vw" className="object-cover" />
      </div>
      {caption ? (
        <figcaption className={`mt-2 border-l-[3px] pl-2 font-mono text-[11px] uppercase tracking-[.14em] text-ink-muted ${accent === "red" ? "border-red" : "border-blue"}`}>
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
