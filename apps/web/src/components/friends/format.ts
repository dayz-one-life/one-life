/**
 * Maps a failed-mutation error code (already_friends, rate_limited, …) to a short human
 * sentence — never a raw code — so a failed request doesn't just silently re-enable the
 * button. `null`/`undefined` means "nothing to report."
 */
export function friendErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case null:
    case undefined:
      return null;
    case "rate_limited":
      return "Too many requests — try again shortly.";
    case "cooldown_active":
      return "You'll need to wait before sending another request.";
    case "already_friends":
      return "You're already friends.";
    case "already_pending":
      return "A request is already pending.";
    case "not_verified":
      return "Only verified players can add friends.";
    case "self_request":
      return "You can't friend yourself.";
    default:
      return "Something went wrong — try again.";
  }
}
