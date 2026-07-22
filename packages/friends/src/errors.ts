/** Every friend-domain failure. The API maps `code` to an HTTP status. */
export class FriendError extends Error {
  constructor(public code: string, public detail?: Record<string, unknown>) {
    super(code);
    this.name = "FriendError";
  }
}
