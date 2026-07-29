"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getAvatar, removeAvatar, syncAvatar, uploadAvatar } from "@/lib/api";
import { Avatar } from "@/components/shared/avatar";
import { SrStatus } from "@/components/shared/sr-status";

const ERROR_MESSAGES: Record<string, string> = {
  too_large: "That image is too large (5 MB max).",
  not_an_image: "That file doesn't look like an image.",
  no_provider_image: "Your login method has no avatar to pull.",
  provider_image_stale:
    "Discord has rotated your photo's link — sign out and back in to refresh it, or upload a photo directly.",
  fetch_failed: "Couldn't reach your login provider just now — try again in a minute.",
};

function avatarErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return ERROR_MESSAGES[err.code] ?? "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

/**
 * Account-page avatar control: current avatar, Upload, Refresh-from-provider, Remove.
 * `["avatar"]` is the one source of truth for the session's own hash — shared with the masthead
 * `AccountAffordance`, which reads the same query key so both update together on a successful
 * mutation.
 *
 * Announcements fire ON SETTLEMENT (each mutation's `onSuccess`/`onError` callback only runs
 * once the request resolves), never at click — the repo-wide SrStatus policy.
 *
 * ⚠️ `announcement` is a plain `useState` set from each mutation's own `onSuccess`/`onError`,
 * NOT derived by reading `isSuccess`/`isError` off all three mutations. TanStack mutation flags
 * stay true after settlement until that SAME mutation object runs again — a priority chain over
 * them (upload > sync > remove, say) would freeze on the first mutation's outcome forever: upload
 * once, then Remove later, and the live region never changes because `upload.isSuccess` is still
 * true and outranks `remove.isSuccess` in the chain. Setting state imperatively in each callback
 * makes "most recently settled" automatic — whichever callback fires last wins, however many
 * mutations have already settled before it.
 *
 * ⚠️ Each mutation ALSO clears `announcement` to `""` in `onMutate` (i.e. the instant it starts,
 * not when it settles). Without this, two consecutive settlements that land on the SAME text
 * (e.g. upload succeeds, then later a sync also succeeds — both "Avatar updated") never change
 * `announcement`'s value, so React bails out of the state update (`Object.is` equality) and the
 * `role="status"` node's text never mutates a second time — a screen reader hears nothing for the
 * second action. Blanking on start forces every settlement through a fresh `""` → message
 * transition, which is what makes assistive tech re-announce even a repeated message.
 */
export function AvatarPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["avatar"] });
    // `["player-page"]` only backs Home's client-side reads — it can't reach the dossier hero,
    // which is server-rendered (`app/(site)/(boxed)/players/[slug]/page.tsx` fetches
    // `getPlayerPage` in an RSC). `router.refresh()` is what actually reaches that hero: it
    // re-runs the server component with fresh data. Both invalidations stay for Home.
    void qc.invalidateQueries({ queryKey: ["player-page"] });
    router.refresh();
  };
  const [announcement, setAnnouncement] = useState("");
  const clearAnnouncement = () => setAnnouncement("");

  const upload = useMutation({
    mutationFn: uploadAvatar,
    onMutate: clearAnnouncement,
    onSuccess: () => { invalidate(); setAnnouncement("Avatar updated"); },
    onError: (err) => setAnnouncement(avatarErrorMessage(err)),
  });
  const sync = useMutation({
    mutationFn: syncAvatar,
    onMutate: clearAnnouncement,
    onSuccess: () => { invalidate(); setAnnouncement("Avatar updated"); },
    onError: (err) => setAnnouncement(avatarErrorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: removeAvatar,
    onMutate: clearAnnouncement,
    onSuccess: () => { invalidate(); setAnnouncement("Avatar removed"); },
    onError: (err) => setAnnouncement(avatarErrorMessage(err)),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pending = upload.isPending || sync.isPending || remove.isPending;

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a failed/successful upload
    if (file) upload.mutate(file);
  };

  const hash = avatar.data?.hash ?? null;

  return (
    <section aria-label="Avatar" className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Avatar hash={hash} size={76} />
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => fileInputRef.current?.click()}
            className="border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red disabled:opacity-50"
          >
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label="Upload avatar image"
            className="sr-only"
            onChange={onFileChange}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => sync.mutate()}
            className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted hover:text-red disabled:opacity-50"
          >
            Refresh from login provider
          </button>
          <button
            type="button"
            disabled={pending || !hash}
            onClick={() => remove.mutate()}
            className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted hover:text-red disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
      {/* Always-mounted (per the SrStatus rule): the live region must pre-exist the text change
       *  it announces, or some screen readers won't pick up the first message. Loading is
       *  deliberately not asserted as "no avatar" here — the silhouette renders either way, with
       *  no accompanying claim about it being resolved-empty. */}
      <SrStatus>{announcement}</SrStatus>
    </section>
  );
}
