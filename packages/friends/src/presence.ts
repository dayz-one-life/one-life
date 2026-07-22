export const FRIEND_ONLINE_COOLDOWN_HOURS = 4;

/** Skip a connect older than this even when it is inside the generator's window: a
 *  "came online" delivered hours late is worse than silence, so a worker that has been
 *  down drops the backlog rather than delivering archaeology. */
export const FRIEND_ONLINE_MAX_AGE_MINUTES = 15;

/**
 * Whether a connect by the subject should notify the observer. Pure, and the single place
 * the four-way AND is expressed.
 *
 * `masterShare` is the SUBJECT's per-user switch (user_preferences.share_presence, default
 * false); `pairShare` is the subject's per-friend flag (default true, i.e. "not individually
 * hidden"); `pairNotify` is the OBSERVER's per-friend flag (default true, i.e. not muted).
 * Effective sharing is master AND pair — which is what makes the default usable: one switch
 * makes you visible to everyone, with per-friend exceptions.
 */
export function shouldNotifyPresence(a: {
  status: string;
  masterShare: boolean;
  pairShare: boolean;
  pairNotify: boolean;
}): boolean {
  return a.status === "accepted" && a.masterShare && a.pairShare && a.pairNotify;
}
