import { ApiError } from "./api";

/** User-facing message for a failed gamertag claim. */
export function claimErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "active_link_exists") return "You already have a gamertag — you can only claim one.";
    if (e.status === 422) return "We haven't seen that gamertag on any server yet.";
    if (e.status === 409) return "That gamertag is already claimed by someone.";
  }
  return "Something went wrong. Please try again.";
}
