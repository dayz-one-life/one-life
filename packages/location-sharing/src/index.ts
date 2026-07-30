export { writeNotification, locationSharedNotification, playerSlug } from "./notify.js";
export type { NotificationDraft } from "./notify.js";
// Sub-project E replaced F2's standing consent model (shouldShareLocation / setLocationFlag /
// getShareLocation / setShareLocation) with session-scoped grants. Do not reintroduce a
// standing location setting — see the ⚠️ at the top of location.js.
export {
  currentSessionStart, grantLocation, revokeLocation, revokeAllLocation,
  clearLocationSharesFor, isShareEffective, activeGrantees,
} from "./location.js";
