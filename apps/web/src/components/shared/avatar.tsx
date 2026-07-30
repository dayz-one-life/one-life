import { cn } from "@/lib/utils";

export function avatarSrc(hash: string): string {
  return `/api/avatars/${hash}.webp`;
}

/**
 * ⚠️ THIS COMPONENT IS THE ONLY PLACE THE AVATAR SHAPE IS STATED.
 * Every avatar on the site is a circle, with no exceptions — including the 132px life-timeline
 * hero. If you are about to add `rounded-full` (or a border, or a fill) to an avatar at a call
 * site, add a variant here instead. The rule previously lived in three places and they drifted.
 *
 * The circle is a CSS mask over a square 256x256 webp — the `sharp` pipeline is untouched, so the
 * shape is retroactive to every stored avatar and no avatar hash or URL changes. See
 * docs/superpowers/specs/2026-07-29-avatar-circle-crop-design.md §2.
 */
const RING = { paper: "border-hairline", dark: "border-dark-edge-bright" } as const;
const DISC = { paper: "bg-bone text-ink-muted", dark: "bg-dark-well text-paper" } as const;

/** Decorative player avatar. Silhouette is the RESOLVED EMPTY state, not an error. alt="". */
export function Avatar({
  hash,
  src,
  size,
  dim = false,
  fallbackInitial,
  variant = "paper",
  className,
  onError,
}: {
  hash: string | null;
  /** Renders THIS url instead of building one from `hash` — e.g. a login provider's photo,
   *  which is never stored under a hash. Still goes through the same circle/ring/variant tokens
   *  below, which is the whole point: a call site that needs to show a foreign image URL must
   *  not hand-roll `rounded-full border ...` itself (see the ⚠️ above). Takes priority over
   *  `hash` when both are given. */
  src?: string;
  size: number;
  dim?: boolean;
  /** When provided (and `hash` is null), renders this initial in the disc instead of the
   *  silhouette SVG. The silhouette remains the default fallback for existing call sites. */
  fallbackInitial?: string;
  /** Surface the avatar sits on. `dark` swaps ring/fill/glyph tokens — see the two-surface token
   *  rule in CLAUDE.md. Getting this wrong renders ink-on-dark: present, functional, invisible. */
  variant?: "paper" | "dark";
  /** Merged LAST through `cn` (twMerge), so it overrides the component's own tokens by class
   *  group rather than competing with them. */
  className?: string;
  /** Only meaningful with `src`: a foreign URL (e.g. Discord's CDN) can go stale and 404. Lets
   *  the caller react to that — `alt=""` stays empty either way (see above), so there is no
   *  built-in fallback text; the caller must render its own visible+SR message. */
  onError?: () => void;
}) {
  const box = { width: size, height: size };
  const disc = cn(
    "flex items-center justify-center rounded-full border",
    RING[variant],
    DISC[variant],
    dim && "opacity-60",
    className,
  );

  if (src) {
    return (
      <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async"
        onError={onError}
        style={box}
        className={cn("rounded-full border object-cover", RING[variant],
          dim && "opacity-60 grayscale", className)} />
    );
  }

  if (hash) {
    return (
      <img src={avatarSrc(hash)} alt="" width={size} height={size} loading="lazy" decoding="async"
        style={box}
        className={cn("rounded-full border object-cover", RING[variant],
          dim && "opacity-60 grayscale", className)} />
    );
  }
  if (fallbackInitial) {
    return (
      <span aria-hidden="true" style={box} className={disc}>
        <span className="font-display font-bold uppercase" style={{ fontSize: size * 0.45 }}>
          {fallbackInitial}
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden="true" style={box} className={disc}>
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}
