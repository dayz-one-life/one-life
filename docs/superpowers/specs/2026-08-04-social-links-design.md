# Social links in the footer — design

**Date:** 2026-08-04
**Status:** approved

## Problem

The site links to nothing off-site. One Life has four community presences — a Facebook page, a
Discord invite, a subreddit and an X account — and a visitor who wants to follow the project has
no way to find any of them. The Discord OAuth login is *not* this: it is a sign-in provider, not
an invite to the community server.

## Scope

Four links, in the footer, sitewide. That is the whole change.

Explicitly **not** in scope, each considered and declined for now:

- `sameAs` on the site's JSON-LD (`apps/web/src/lib/seo.ts`). Real SEO value, but it is a
  metadata change with its own verification story; keep it separable.
- A block on `/about` or on home. The footer is where people look, and the home page's job is
  conversion, not outbound links.
- A "Community" section in the `☰` nav panel. That panel is nav + account; a third section earns
  its way in only if the footer proves insufficient.

## The links

| Label | URL |
| --- | --- |
| Facebook | `https://www.facebook.com/profile.php?id=61591632406315` |
| Discord | `https://discord.gg/gdCdgmjhRe` |
| Reddit | `https://www.reddit.com/r/dayzonelife/` |
| X | `https://x.com/onelifexbox` |

## Components

### `apps/web/src/components/social-links.tsx` (new)

Exports `SOCIAL_LINKS` (label, href, SVG path data) and a `SocialLinks` component.

The array is a named export and lives in its own module rather than inline in `footer.tsx`
specifically so the URLs have one home — the declined items above (JSON-LD `sameAs`, an `/about`
block) all want the same four URLs, and a second copy of them is a future drift bug.

Each entry renders as a plain `<a>`:

- **`<a>`, not `next/link`.** These are external; the router has nothing to prefetch.
- `target="_blank"` with `rel="noopener noreferrer"`.
- `aria-label={label}` on the anchor. The anchor's only child is an `aria-hidden` `<svg>`, so
  without the label the link has **no accessible name at all** — a screen reader announces four
  unnamed links. This is the load-bearing line in the file.
- `h-11 w-11` flex-centred, holding a 20px glyph. 44px is the tap-target floor the `☰` button in
  `shell/nav-menu.tsx` already sets; the glyph being 20px is cosmetic, the 44px box is not.
- `fill="currentColor"` on the SVG, so the icons inherit the footer's `text-paper` and take the
  same `hover:text-red` the text links use. No per-brand colour: brand colours on a `bg-dark`
  footer would fight the paper/red palette, and four saturated logos read as an ad strip.

Path data is Simple Icons v13, copied verbatim. These are trademarked brand marks reproduced for
the purpose of linking to those services; do not restyle the glyphs themselves.

Wrapped in `<nav aria-label="One Life on social media">` — a peer to the existing
`<nav aria-label="Site information">`, so the two rows are distinguishable in a landmark list.

### `apps/web/src/components/footer.tsx` (changed)

One line: `<SocialLinks />` above the existing `<nav aria-label="Site information">`, with the
icon row carrying its own bottom margin.

Nothing else in the footer moves. In particular the `pb-[calc(18px+env(safe-area-inset-bottom))]`
and the `flex-wrap` on the text row keep their ⚠️ comments and their current behaviour — the icon
row is added *above* the existing content, so it cannot affect the bottom inset.

The icon row also gets `flex-wrap`, for the same reason the text row has it. Four 44px targets is
176px and fits a 320px column with room to spare, so it should never actually wrap; the wrap is
there because a fifth link one day would silently overflow otherwise.

## Rendering

```
        [f]  [discord]  [reddit]  [X]

  ABOUT · OBITUARIES · TERMS · PRIVACY
   One Life — hardcore · 1PP · US servers
```

## Testing

Extend `apps/web/src/components/footer.test.tsx`:

- all four links are present and findable **by accessible name** (`getByRole("link", { name })`) —
  this is the assertion that fails if the `aria-label` is ever dropped;
- each has its exact `href`;
- each carries `rel` containing `noopener` and `target="_blank"`;
- the SVGs are `aria-hidden`, so the accessible name comes from the anchor and not from stray
  glyph text;
- the existing four text links still resolve — the new `<nav>` must not make
  `getByRole("link", { name: "About" })` ambiguous.

**What the tests cannot prove**, and must therefore not be claimed as verified: that the row does
not wrap at 320px, that the 44px targets are actually 44px as painted, and that the glyphs are
legible against `bg-dark`. Per the repo's house rule, RTL asserts the DOM, not layout. These are
browser checks against a deployed build, via CDP `Emulation.setDeviceMetricsOverride`.

## Risks

Low. The change is additive, touches no data path, and the failure mode of a wrong URL is a dead
link rather than a broken page. The one real hazard is the accessible-name regression described
above, which the test pins.
