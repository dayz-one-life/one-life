"use client";
import { useRef, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getAvatar, removeAvatar, syncAvatar, uploadAvatar } from "@/lib/api";
import { Avatar } from "@/components/shared/avatar";
import { SrStatus } from "@/components/shared/sr-status";

const ERROR_MESSAGES: Record<string, string> = {
  too_large: "That image is too large (5 MB max).",
  not_an_image: "That file doesn't look like an image.",
  no_provider_image: "Your login method has no avatar to pull.",
  fetch_failed: "Couldn't reach your login provider. Try again.",
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
 * Announcements fire ON SETTLEMENT (a mutation's `isSuccess`/`isError` flips only once the
 * request resolves), never at click — the repo-wide SrStatus policy.
 */
export function AvatarPanel() {
  const qc = useQueryClient();
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["avatar"] });

  const upload = useMutation({ mutationFn: uploadAvatar, onSuccess: invalidate });
  const sync = useMutation({ mutationFn: syncAvatar, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: removeAvatar, onSuccess: invalidate });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pending = upload.isPending || sync.isPending || remove.isPending;

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a failed/successful upload
    if (file) upload.mutate(file);
  };

  // Whichever mutation most recently settled wins the announcement. Each branch only becomes
  // true once its own request resolves, so this can never fire at click time.
  let announcement = "";
  if (upload.isSuccess || sync.isSuccess) announcement = "Avatar updated";
  else if (remove.isSuccess) announcement = "Avatar removed";
  else if (upload.isError) announcement = avatarErrorMessage(upload.error);
  else if (sync.isError) announcement = avatarErrorMessage(sync.error);
  else if (remove.isError) announcement = avatarErrorMessage(remove.error);

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
