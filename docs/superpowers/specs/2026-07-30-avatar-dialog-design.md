# Avatar dialog — design

Date: 2026-07-30
Status: approved, not yet implemented

## Problem

The owner's avatar edit lives on the verified home's ticket stage. Today the stage's pencil
toggles `AvatarPanel` inline, directly underneath the 112px stage avatar. Three things are wrong
with it, and Steve hit all three:

1. **The Upload button is invisible.** `AvatarPanel` styles its buttons `text-ink` and
   `text-ink-muted`. `StageAvatar` mounts it inside the stage's `bg-dark` section. Dark text on a
   dark slab. The button is there, focusable, and clickable — it just cannot be seen.
2. **The panel duplicates the thing it edits.** It renders a *second*, smaller (76px) avatar
   below the 112px one already on the stage, so the page shows the same photo twice at two sizes
   and it is not obvious which one the controls act on.
3. **There is no commit point.** Picking a file uploads it immediately. There is no preview, no
   confirmation, and no undo. The API then centre-crops to 256×256 with sharp's `fit: "cover"`
   (`apps/api/src/lib/avatar-image.ts`), so a tall photo silently loses its top and bottom and
   the player only finds out by looking at the result.

The shape is unlike the avatar edit on any site a player has used.

## Approach

Replace the inline panel with a modal dialog carrying a real crop stage. Chosen over
click-to-upload-in-place (no preview, no undo) and over restyling the inline panel (fixes the
colours, leaves the unfamiliar shape and the missing commit point).

Cropping is a real drag-and-zoom stage, not a static preview: the player positions a circular
mask over the image and the browser exports the chosen square. The server's `fit: "cover"` then
becomes a no-op on an already-square upload, so the crop the player chose is the crop they get.

## Components

| File | Role |
| --- | --- |
| `components/account/avatar-dialog.tsx` *(new)* | Modal shell. Portal to `document.body`, `useModalBehavior`, `z-50`, dark panel. |
| `components/account/crop-geometry.ts` *(new)* | Pure pan/zoom math. No DOM, no React. |
| `components/account/avatar-cropper.tsx` *(new)* | The crop stage: masked image, pointer drag, zoom slider, `cropToBlob()`. |
| `components/account/avatar-panel.tsx` *(rewritten)* | The dialog's body: draft state, the three mutations, `SrStatus`. |
| `components/player/stage-avatar.tsx` *(edited)* | Pencil opens the dialog instead of unfolding a panel. |

`StageAvatar`'s pencil remains the **single** edit path. The existing ⚠️ on that file — two edit
paths on one page is how the avatar work shipped twice — is unchanged by this design.

### Why the dialog must portal

`StageAvatar` renders inside the stage `<section>`. A `position: fixed` overlay nested under a
CSS-transformed ancestor collapses into that ancestor's box instead of the viewport, and jsdom
cannot see the difference. The dialog portals to `document.body` behind an App-Router-safe
mounted guard. `ClaimModal` gets away without one only because it is mounted at page level.

### Layer

`z-50`, matching `ClaimModal` and the LAYER LEGEND at the `<header>` in `components/header.tsx`.
This is the "full-screen overlays that must cover the chrome" altitude. No new altitude.

## The staged draft

One piece of state drives the whole interaction:

```ts
type Draft =
  | { kind: "current" }                        // nothing staged; Save disabled
  | { kind: "file"; file: File; url: string }  // picked, croppable
  | { kind: "provider" }                       // "Use my Discord photo"
  | { kind: "removed" }                        // "Remove photo"
```

Every action in the dialog stages a draft. **Save is the only commit point**, and it dispatches
on `kind`:

| `kind` | Save does |
| --- | --- |
| `current` | nothing — the button is disabled |
| `file` | `cropToBlob()` → 512² WebP → `uploadAvatar(file)` |
| `provider` | `syncAvatar()` |
| `removed` | `removeAvatar()` |

Cancel, Escape, and the close button all discard the draft and `URL.revokeObjectURL` any staged
object URL. Cancel therefore always means *nothing happened* — including after the player clicked
"Remove photo". That consistency is the point: an interface where Cancel undoes some actions and
not others is the kind that feels unpredictable even when every individual action works.

### Staging the Discord photo

`syncAvatar` is a server-side fetch — the client cannot ask for the image without also storing
it, so a staged `provider` draft has nothing to preview from the API.

The preview therefore renders `useSession()`'s `user.image`. `apps/web/src/lib/api.ts:264`
forbids deriving an avatar from that value because **public surfaces must not hotlink the raw
provider URL** — this dialog is the owner's own session-gated surface, so the rule is not
breached. Do not carry the URL anywhere else.

This has a useful side effect. Discord rotates its CDN links, which is what the existing
`provider_image_stale` 409 reports. If the link has rotated, the preview `<img>` fires `onError`
*before* Save, so the dialog can say so up front instead of failing after the commit. On error:
show the `provider_image_stale` copy inline and leave Save enabled — the server is the authority,
and a preview that failed to load is not proof the sync will.

## Crop geometry

`crop-geometry.ts` holds the math as pure functions over a view state of `{ scale, offsetX,
offsetY }`:

- `clampView(view, image, frame)` — constrains pan and zoom so the circular frame is **always
  fully covered**. The image can never be positioned to leave a transparent gutter inside the
  circle, so there is no way to produce an avatar with a bite out of it.
- `sourceRect(view, image, frame)` — converts the view state to the source-pixel rectangle to
  draw, which is what `cropToBlob` hands to the canvas.
- Minimum scale is whatever makes the shorter image edge exactly fill the frame; the slider runs
  from there to 3×.

Export is 512×512 WebP at quality 0.9. The server downsizes to 256 either way; 512 keeps the
result crisp on hi-dpi and stays comfortably under `AVATAR_MAX_BYTES`.

Drag uses **pointer events**, not mouse events, so it works on touch without a second code path.

## Error handling

The existing `ERROR_MESSAGES` map and `avatarErrorMessage()` carry over unchanged — they already
cover `too_large`, `not_an_image`, `no_provider_image`, `provider_image_stale`, and
`fetch_failed`.

The `SrStatus` rules in `avatar-panel.tsx`'s header comment carry over **verbatim**. Both ⚠️
paragraphs document shipped bugs: announcements set imperatively per-callback rather than derived
from TanStack's `isSuccess`/`isError` flags, and each mutation blanking `announcement` in
`onMutate` so a repeated message still re-announces. The rewrite must not quietly drop either.

On a failed Save the dialog **stays open** with the draft intact, so the player can retry or pick
a different file. Only a successful Save closes it.

## Testing

RTL covers:

- the dialog opens from the pencil, closes on Escape / backdrop / close button, and restores
  focus to the pencil;
- each action stages the right draft, and the preview reflects it;
- Save dispatches the correct mutation for each `kind`, and is disabled for `current`;
- Cancel after staging a removal commits nothing — no mutation fires;
- a failed Save leaves the dialog open with the draft intact;
- the error map, and the two `SrStatus` behaviours (announce on settlement; a repeated message
  still announces).

`crop-geometry.ts` is unit-tested directly as pure math — coverage of the circle, clamping at
both scale extremes, and the source rectangle at known view states.

`cropToBlob` is **injectable** so the dialog tests can stub it; jsdom has no canvas.

### Not closed by the test suite

RTL asserts the DOM, not paint or pointer geometry. These need a real browser and a signed-in
verified session, and belong on CLAUDE.md's outstanding-work list rather than in a green run:

- the drag and the zoom slider actually moving the image, including under touch;
- the saved avatar matching what the preview showed;
- the dialog rendering above the masthead and the tab bar, and not collapsing into the stage's
  stacking context;
- the dialog at 320px and on a notched phone in PWA/standalone.

## Out of scope

- Any change to the avatar API. `fit: "cover"` stays; it simply stops mattering for uploads.
- The masthead `AccountAffordance` avatar — it reads the same `["avatar"]` query key and updates
  for free.
- Animated avatars, GIF support, avatar history.
