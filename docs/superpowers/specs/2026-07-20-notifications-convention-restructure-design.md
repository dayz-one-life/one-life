# Notifications convention restructure — design

**Date:** 2026-07-20
**Status:** Approved
**Scope:** `apps/web` only. No API, notifier, or schema changes.

## 1. Problem

Notifications shipped as a section of the account-controls surface — a collapsible
`NotificationsPanel` inside the rail (desktop `xl+`) and the mobile bottom sheet. That breaks
the near-universal convention (GitHub, YouTube, Discord, Reddit): a bell in the global header
at every viewport, a badge as the ambient signal, one tap to a glanceable list, and a
permanent inbox URL. Concrete failures:

- **No ambient signal.** The unread badge is inside a collapsed panel, two interactions deep
  on mobile. The floating pill shows server dots and token balance but no unread indicator.
- **Sheet-over-destination bug.** Notification rows are `<Link>`s; `ControlsSheet` does not
  watch the route, so tapping a row navigates *underneath* the still-open sheet.
- **Read state evaporates mid-glance.** Opening the panel marks rendered rows read and
  invalidates `["notifications"]`; the unread tint refetches away while the user is reading.
- **iOS silently shows nothing.** `PushToggle` returns `null` on `unsupported`, which is
  every iPhone browsing outside an installed PWA — no toggle, no explanation.
- Sub-44pt touch targets on every control in the panel; color-only unread/kind signals; a
  bare unlabeled badge number for screen readers; no linkable inbox URL for push landings.

## 2. Decisions (locked with the user)

1. **Masthead bell icon + badge**, top-right, all widths, signed-in only.
2. **Desktop (`md+`): anchored popover** with page 1 + "View all →"; **mobile: plain link**
   to `/notifications`.
3. **`/notifications` page** — the permanent, linkable inbox.
4. **Rail and sheet drop the notifications panel entirely.**
5. **`PushToggle` moves to the `/notifications` page** (settings block), losing `onDark`.
6. **Feel fixes ride along**: frozen tint, iOS explainer, aria labels, 44pt targets,
   non-color unread cue.
7. **No notification content changes** — kinds, copy, hrefs, and the API contract
   (`GET /me/notifications`, `POST /me/notifications/read`) are untouched.

## 3. Surfaces

### 3.1 Masthead bell (`MastheadBell`, client island in `header.tsx`)

- Renders only when signed in (unlinked/pending/verified — the bell exists before
  verification so `gamertag_verified` has somewhere to land; it shows an empty inbox until
  then). Signed out: renders nothing.
- Position: `absolute right-4` in the masthead top row — mirroring the hamburger's `left-4`
  on mobile; same slot at desktop widths.
- Paper-colored inline SVG bell (hand-rolled path, matching the hamburger idiom — no icon
  package dependency). Red mono count badge, display-capped at `9+`; the accessible label
  carries the real number.
- One button/link with computed `aria-label` (`"Notifications"` /
  `"Notifications, N unread"`); the visual badge is `aria-hidden`. Desktop trigger adds
  `aria-expanded` + `aria-haspopup="dialog"`.
- ≥44pt hit area via padding (`p-2`+ on a 24px glyph, like the hamburger).
- A broken bell must never break the header: query errors render the last cached state, no
  error chrome in the masthead.

### 3.2 Desktop popover (`NotificationsPopover`)

- Anchored dropdown off the bell at `md+`. Dark surface (hangs off the `bg-dark` masthead) —
  uses the on-dark token set.
- Shows **page 1 only**; no "Load older". Footer: `View all →` linking `/notifications`.
- Compact density is acceptable here (mouse-first surface).
- Close on: Escape, outside click, bell re-click, and `usePathname()` change (row clicks
  navigate *and* dismiss — the sheet bug class cannot recur). Uses `useModalBehavior` for
  focus trap/restore + Escape.

### 3.3 `/notifications` page

- Normal main-column page on light paper. Display `<h1>`: **The Wire**; route metadata title
  "Notifications". `loading.tsx` skeleton matching the boards' idiom.
- Full paginated list; "Load older" is a `min-h-[44px]` full-width-tappable row. Notification
  rows get `py-2.5`.
- `PushToggle` in a bordered settings block at the bottom of the page.
- Signed out: a sign-in CTA in the page frame, **not** a redirect — the URL keeps working as
  a push landing target through a session lapse.
- The page is not a nav item; `nav.ts` is untouched.

### 3.4 Rail and sheet

- `ControlsRail` and `MobileControls` drop `NotificationsPanel` and `PushToggle`. The
  `Controls` type drops `notifications`/`unreadCount`/`hasMore`/`loadMore`/`loadingMore`;
  `useControlsActions` drops `markRead`.

## 4. Components and files

```
apps/web/src/lib/use-notifications.ts        new — extracted from use-controls
apps/web/src/components/notifications/
  row.tsx          NotificationRow      props-only: one <Link> row; accent, tint, NEW tag
  list.tsx         NotificationList     props-only: rows + empty state + optional load-older
  bell.tsx         MastheadBell         container: bell button/link + badge + popover mount
  popover.tsx      NotificationsPopover props-only: dark dropdown chrome around a List
  push-toggle.tsx  moved from controls/; `onDark` prop deleted (single light surface)
apps/web/src/app/notifications/
  page.tsx         thin container: useNotifications + List + PushToggle
  loading.tsx      skeleton
```

- **Deleted:** `controls/notifications-panel.tsx` + test. `relativeTime` and `accentFor`
  move to `row.tsx` with their tests.
- **Surface variants:** `NotificationRow`/`NotificationList` keep an `onDark` flag — popover
  dark, page light. The dual-background token-swap discipline (and its pinning test)
  transfers from the panel to the row. This is the only place the ⚠️ two-surfaces rule still
  applies to notifications.
- Presentational pieces are props-only + unit-tested; containers stay thin and untested
  (repo convention).

## 5. Data flow and read-state semantics

### 5.1 One hook, one cache

`useNotifications()` owns the `["notifications"]` infinite query (60s `refetchInterval`,
enabled when signed in) and the mark-read mutation. The bell mounts it globally — that is
what makes the badge ambient — and the page shares the same cache, so it opens warm.

### 5.2 Marking read

- The at-most-once `sent`-ref logic moves intact: a surface reports the ids of unread rows
  **it actually rendered**, nothing deeper (notifier invariant #6). Popover reports page 1;
  the page reports each page as "Load older" reveals it.
- **No "mark all read".** The API accepts explicit ids only; a blanket endpoint would
  violate the shipped invariant. Draining a deep backlog remains page-by-page, by design.

### 5.3 The evaporation fix

1. On mark-read success, **no invalidation**. `setQueryData` stamps `readAt` on the affected
   rows and decrements the cached `unreadCount`. The 60s refetch is the reconciler.
2. **Tint is frozen at first render.** Each surface captures an `initiallyUnread` id-set as
   rows first appear; a row shows unread styling iff its id is in that set, for the life of
   the surface session (popover open→close; page mount→unmount). The badge zeroes promptly
   (convention: opening the inbox clears the count) while rows being read keep their unread
   look until the user leaves. Next visit they render read.

### 5.4 Badge count

Keeps the existing freshest-page derivation from the infinite query; display-capped `9+`.

## 6. Feel fixes

- **Non-color unread cue:** mono `NEW` tag (red on light, red-soft on dark) beside the
  timestamp on unread rows, driven by the same `initiallyUnread` set as the tint.
- **Timestamps:** `relativeTime` gains a final rung — past 7 days, render a mono uppercase
  dateline (`JUL 12`) instead of `Nd ago`.
- **iOS explainer:** `PushToggle`'s `unsupported` state no longer returns `null`. iOS Safari
  outside standalone mode (`!("PushManager" in window)` + iOS UA + `navigator.standalone !==
  true`): *"Push needs One Life on your home screen — Share → Add to Home Screen, then come
  back here."* Genuinely unsupported browsers: *"Push isn't supported in this browser."*
- **Empty state:** "Nothing on the wire." survives verbatim on both surfaces.

## 7. Error handling

- **Query error, warm cache:** keep cached rows; badge shows last known count; no error
  chrome in the masthead.
- **Query error, cold cache:** popover/page show a mono "Couldn't reach the wire.
  Retrying." line. The query's retry/60s interval is the recovery path; the page adds a
  manual retry button, the popover does not.
- **Mark-read failure:** silent. Ids stay in the surface's `sent` ref, but the local
  `readAt` stamp happens only on success — the server and the next refetch re-surface the
  rows as unread. Worst case: a badge that won't zero until a later successful mark.
- **PushToggle:** existing error asymmetry (the "STILL ON" copy) unchanged.

## 8. Testing

- `NotificationRow`/`NotificationList` (RTL): accent mapping; tint-from-props, pinning the
  frozen-tint contract (not derived from `readAt`); the `NEW` tag; the on-dark token swap
  (the v0.26.0 invisible-panel bug class gets its pinning test on the row); empty state;
  load-older states.
- `MastheadBell`: badge render + `9+` cap; `aria-label` text; hidden when signed out;
  link-vs-popover per breakpoint.
- `useNotifications`: the `sent`-ref at-most-once guarantee; the setQueryData-without-
  invalidation success path.
- `relativeTime`: the dateline rung.
- `push-toggle.test.tsx`: the two unsupported-state renderings.
- `rail.test.tsx` / `mobile-controls.test.tsx`: panel assertions removed.

## 9. Non-goals

- No API/notifier/schema changes; no new endpoints; no mark-all-read.
- No notification content, copy, or kind changes.
- No nav-item addition; no unread indicator on the mobile controls pill (superseded by the
  masthead bell).
- Popover pagination (page 1 only is deliberate).
