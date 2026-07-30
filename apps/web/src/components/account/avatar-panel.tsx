"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getAvatar, removeAvatar, syncAvatar, uploadAvatar } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { Avatar } from "@/components/shared/avatar";
import { AvatarCropper, cropToBlob as realCropToBlob, type CropToBlob, type CropperHandle } from "./avatar-cropper";

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
 * ⚠️ ONE staged draft drives the whole dialog, and SAVE IS THE ONLY COMMIT POINT. Nothing here
 * writes to the server until Save — including "Remove photo", which previously fired on click.
 * That is what makes Cancel mean "nothing happened" in every case; an interface where Cancel
 * undoes some actions and not others reads as unpredictable even when each one works.
 */
type Draft =
  | { kind: "current" }
  | { kind: "file"; file: File; url: string }
  | { kind: "provider" }
  | { kind: "removed" };

const ACTION = "text-left font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted hover:text-paper disabled:opacity-50";

/**
 * The dialog's body: the pending avatar, the three ways to change it, and Save.
 *
 * `["avatar"]` is the one source of truth for the session's own hash — shared with the masthead
 * `AccountAffordance`, which reads the same query key so both update together on a successful
 * mutation.
 *
 * Announcements fire ON SETTLEMENT (each mutation's `onSuccess`/`onError` callback only runs
 * once the request resolves), never at click — the repo-wide SrStatus policy.
 *
 * ⚠️ The live region does NOT live in this component — the caller owns it and passes
 * `onAnnounce`. A successful save calls `onSaved()`, which the dialog uses to close (unmount)
 * this panel, IN THE SAME COMMIT as the announcement text would have been set. A `role="status"`
 * node that unmounts in the same commit as its text changes announces nothing — the live region
 * has to already have gone from the accessibility tree by the time the text would have differed,
 * so screen readers never see the change at all. Every "Avatar updated"/"Avatar removed" success
 * announcement was silently lost this way until this was caught in review. The fix is structural,
 * not a workaround: `SrStatus` must be rendered by something that OUTLIVES the dialog (currently
 * `StageAvatar`, a sibling of the dialog rather than a descendant of this panel), and this
 * component only ever calls the `onAnnounce` callback it's handed.
 *
 * ⚠️ `onAnnounce` is called imperatively from each mutation's own `onSuccess`/`onError` (and from
 * the crop-failure catch in `onSave`), NOT derived by reading `isSuccess`/`isError` off all three
 * mutations. TanStack mutation flags stay true after settlement until that SAME mutation object
 * runs again — a priority chain over them (upload > sync > remove, say) would freeze on the first
 * mutation's outcome forever: upload once, then Remove later, and the live region never changes
 * because `upload.isSuccess` is still true and outranks `remove.isSuccess` in the chain. Calling
 * `onAnnounce` imperatively in each callback makes "most recently settled" automatic — whichever
 * callback fires last wins, however many mutations have already settled before it.
 *
 * ⚠️ Each mutation ALSO calls `onAnnounce("")` in `onMutate` (i.e. the instant it starts, not
 * when it settles). Without this, two consecutive settlements that land on the SAME text (e.g.
 * upload succeeds, then later a sync also succeeds — both "Avatar updated") never change the
 * caller's `announcement` state, so React bails out of the state update (`Object.is` equality)
 * and the `role="status"` node's text never mutates a second time — a screen reader hears nothing
 * for the second action. Blanking on start forces every settlement through a fresh `""` →
 * message transition, which is what makes assistive tech re-announce even a repeated message.
 */
export function AvatarPanel({
  onSaved,
  onAnnounce,
  cropToBlob = realCropToBlob,
}: {
  onSaved: () => void;
  onAnnounce: (message: string) => void;
  cropToBlob?: CropToBlob;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar });
  const session = useSession();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["avatar"] });
    // `["player-page"]` only backs Home's client-side reads — it can't reach the dossier hero,
    // which is server-rendered (`app/(site)/(boxed)/players/[slug]/page.tsx` fetches
    // `getPlayerPage` in an RSC). `router.refresh()` is what actually reaches that hero: it
    // re-runs the server component with fresh data. Both invalidations stay for Home.
    void qc.invalidateQueries({ queryKey: ["player-page"] });
    router.refresh();
  };
  const clearAnnouncement = () => onAnnounce("");
  const settled = (message: string) => () => { invalidate(); onAnnounce(message); onSaved(); };

  const upload = useMutation({
    mutationFn: uploadAvatar,
    onMutate: clearAnnouncement,
    onSuccess: settled("Avatar updated"),
    onError: (err) => onAnnounce(avatarErrorMessage(err)),
  });
  const sync = useMutation({
    mutationFn: syncAvatar,
    onMutate: clearAnnouncement,
    onSuccess: settled("Avatar updated"),
    onError: (err) => onAnnounce(avatarErrorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: removeAvatar,
    onMutate: clearAnnouncement,
    onSuccess: settled("Avatar removed"),
    onError: (err) => onAnnounce(avatarErrorMessage(err)),
  });

  const [draft, setDraft] = useState<Draft>({ kind: "current" });
  const [providerBroken, setProviderBroken] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropperRef = useRef<CropperHandle>(null);
  const pending = upload.isPending || sync.isPending || remove.isPending;

  const hash = avatar.data?.hash ?? null;
  const providerImage = session.data?.user?.image ?? null;

  // ⚠️ The staged object URL is revoked when the draft is replaced or the panel unmounts. A
  // dialog that is opened and cancelled repeatedly otherwise leaks one blob per pick.
  useEffect(() => {
    if (draft.kind !== "file") return;
    return () => URL.revokeObjectURL(draft.url);
  }, [draft]);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a failed save
    if (file) setDraft({ kind: "file", file, url: URL.createObjectURL(file) });
  };

  const onSave = async () => {
    if (draft.kind === "file") {
      let blob;
      try {
        blob = await cropperRef.current!.crop();
      } catch (err) {
        // `crop()` throws on `canvas_unavailable`, `encode_failed`, and "image not loaded" — a
        // real (if rare) failure mode, not just a defensive catch. Left unhandled this was an
        // unhandled promise rejection: no message, no error state, Save left enabled, and the
        // user told nothing at all.
        onAnnounce(avatarErrorMessage(err));
        return;
      }
      upload.mutate(new File([blob], "avatar.webp", { type: "image/webp" }));
    } else if (draft.kind === "provider") {
      sync.mutate();
    } else if (draft.kind === "removed") {
      remove.mutate();
    }
  };

  // Save needs a croppable image actually loaded, not merely a file picked.
  const [cropReady, setCropReady] = useState(false);
  const [cropBroken, setCropBroken] = useState(false);
  useEffect(() => { setCropReady(false); setCropBroken(false); }, [draft]);

  const canSave =
    !pending &&
    (draft.kind === "provider" ||
      (draft.kind === "removed" && (hash != null || avatar.isLoading)) ||
      (draft.kind === "file" && cropReady));

  return (
    <section aria-label="Your photo" className="flex flex-col gap-5 p-5">
      <div className="flex flex-col items-center gap-4">
        {draft.kind === "file" ? (
          <AvatarCropper
            ref={cropperRef}
            src={draft.url}
            cropToBlob={cropToBlob}
            onReady={() => setCropReady(true)}
            onError={() => {
              // "loading, failed, empty and zero are four different renders": a file that can't
              // be decoded (corrupt, or a non-image renamed to look like one) must not leave the
              // stage silently stuck forever — surface it both to the live region and visibly.
              setCropBroken(true);
              onAnnounce(ERROR_MESSAGES.not_an_image!);
            }}
          />
        ) : draft.kind === "provider" && providerImage ? (
          <Avatar
            hash={null}
            src={providerImage}
            size={112}
            variant="dark"
            onError={() => setProviderBroken(true)}
          />
        ) : (
          <Avatar hash={draft.kind === "removed" ? null : hash} size={112} variant="dark" />
        )}
      </div>

      {draft.kind === "provider" && providerBroken && (
        <p role="alert" className="font-mono text-[11px] leading-relaxed text-red">
          {ERROR_MESSAGES.provider_image_stale}
        </p>
      )}

      {draft.kind === "file" && cropBroken && (
        <p role="alert" className="font-mono text-[11px] leading-relaxed text-red">
          {ERROR_MESSAGES.not_an_image}
        </p>
      )}

      <div className="flex flex-col items-start gap-2.5 border-t border-dark-line pt-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
          className="border-b-2 border-yellow font-display text-sm font-semibold uppercase tracking-[.06em] text-paper hover:text-yellow disabled:opacity-50"
        >
          {draft.kind === "file" ? "Choose a different image" : "Choose an image"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label="Choose an image"
          className="sr-only"
          onChange={onFileChange}
        />
        <button
          type="button"
          disabled={pending || !providerImage}
          onClick={() => { setProviderBroken(false); setDraft({ kind: "provider" }); }}
          className={ACTION}
        >
          Use my Discord photo
        </button>
        <button
          type="button"
          disabled={pending || (!hash && !avatar.isLoading)}
          onClick={() => setDraft({ kind: "removed" })}
          className={ACTION}
        >
          Remove photo
        </button>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-dark-line pt-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => { setProviderBroken(false); setDraft({ kind: "current" }); }}
          className={ACTION}
        >
          Reset
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void onSave()}
          className="min-h-[44px] border-2 border-yellow bg-yellow px-6 font-display text-sm font-bold uppercase tracking-[.06em] text-dark hover:bg-paper disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
