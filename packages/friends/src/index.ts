export {
  orderPair, viewOf, cooldownEnd,
  FRIEND_REQUEST_COOLDOWN_DAYS, FRIEND_REQUEST_DAILY_LIMIT,
} from "./pair.js";
export type { FriendshipRow, FriendStatus, FriendView } from "./pair.js";
export { FriendError } from "./errors.js";
export { writeNotification, requestNotification, acceptedNotification, playerSlug } from "./notify.js";
export type { FriendNotificationDraft } from "./notify.js";
export { request, cancel, accept, decline, remove } from "./mutations.js";
export { escapeLikePattern } from "./mutations.js";
export { listFriends, statusFor, FRIENDS_PAGE_SIZE } from "./queries.js";
export type { FriendEntry } from "./queries.js";
export { shouldNotifyPresence, FRIEND_ONLINE_COOLDOWN_HOURS, FRIEND_ONLINE_MAX_AGE_MINUTES } from "./presence.js";
export { setPresenceFlags, getSharePresence, setSharePresence } from "./presence.js";
// Sub-project E replaced F2's standing consent model (shouldShareLocation / setLocationFlag /
// getShareLocation / setShareLocation) with session-scoped grants. Do not reintroduce a
// standing location setting — see the ⚠️ at the top of location.js.
export {
  currentSessionStart, grantLocation, revokeLocation, revokeAllLocation,
  clearLocationSharesFor, isShareEffective,
} from "./location.js";
