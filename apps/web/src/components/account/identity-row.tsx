import { avatarSrc } from "@/components/shared/avatar";
import { initialOf } from "./format";

/** Decorative lettered disc standing in for an avatar when no real avatar hash is available yet
 *  (loading, or the session genuinely has none). Once a hash resolves, `IdentityRow` renders the
 *  real login avatar in its place — see `avatarHash` below. */
export function AvatarDisc({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      className="flex flex-none items-center justify-center rounded-full bg-discord font-display font-semibold text-white"
    >
      {initialOf(name)}
    </span>
  );
}

export function IdentityRow({
  name,
  provider,
  tagLine,
  verified = false,
  avatarHash,
}: {
  name: string;
  provider: string | null;
  tagLine?: string | null;
  verified?: boolean;
  /** `undefined`/`null` (loading or genuinely none) falls back to the lettered disc. */
  avatarHash?: string | null;
}) {
  const sub = [provider ? `Via ${provider}` : null, tagLine ?? null].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3">
      {avatarHash ? (
        <img
          src={avatarSrc(avatarHash)}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 flex-none rounded-full border border-hairline object-cover"
        />
      ) : (
        <AvatarDisc name={name} />
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-[19px] font-semibold uppercase leading-tight text-ink">{name}</p>
        {sub && <p className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{sub}</p>}
      </div>
      {verified && (
        <span className="ml-auto -rotate-6 border-2 border-red px-2.5 pb-0.5 pt-1 font-display text-xs font-bold uppercase tracking-[.12em] text-red-deep">
          Verified
        </span>
      )}
    </div>
  );
}
