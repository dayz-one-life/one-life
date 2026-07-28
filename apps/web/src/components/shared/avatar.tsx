import { cn } from "@/lib/utils";

export function avatarSrc(hash: string): string {
  return `/api/avatars/${hash}.webp`;
}

/** Decorative player avatar. Silhouette is the RESOLVED EMPTY state, not an error. alt="". */
export function Avatar({
  hash,
  size,
  dim = false,
  fallbackInitial,
}: {
  hash: string | null;
  size: number;
  dim?: boolean;
  /** When provided (and `hash` is null), renders this initial in the disc instead of the
   *  silhouette SVG. The silhouette remains the default fallback for existing call sites. */
  fallbackInitial?: string;
}) {
  const box = { width: size, height: size };
  if (hash) {
    return (
      <img src={avatarSrc(hash)} alt="" width={size} height={size} loading="lazy" decoding="async"
        style={box} className={cn("border border-hairline object-cover", dim && "opacity-60 grayscale")} />
    );
  }
  if (fallbackInitial) {
    return (
      <span aria-hidden="true" style={box}
        className={cn("flex items-center justify-center border border-hairline bg-bone text-ink-muted", dim && "opacity-60")}>
        <span className="font-display font-bold uppercase" style={{ fontSize: size * 0.45 }}>
          {fallbackInitial}
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden="true" style={box}
      className={cn("flex items-center justify-center border border-hairline bg-bone text-ink-muted", dim && "opacity-60")}>
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}
