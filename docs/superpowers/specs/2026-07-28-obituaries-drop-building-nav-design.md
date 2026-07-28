# Obituaries: drop base-building, add nav link

**Date:** 2026-07-28
**Status:** design
**Follows:** `2026-07-28-obituaries-revival-design.md`

## 1. Why

The obituaries revival went live on 2026-07-28 and published its first 11 articles. Seven of them
write about base-building:

> Three hundred ninety-nine structures rose from nothing — a testament to industry, or possibly to
> a man who built walls faster than he could ever bring himself to use a weapon behind them.

Building is not what an obituary is about. It reads as inventory, it crowds out the life and the
death, and in one case ("399 structures") it is the whole article. It comes out.

Separately, `/obituaries` shipped with **no link anywhere on the site**. The feed is reachable only
by typing the URL or following a life-timeline link, which makes a headline feature of the release
effectively invisible.

## 2. Building enters two ways, and both must close

**(a) The fact.** `prompt.ts` feeds `- Things built this life: N` from `ordeals.buildsPlaced`. This
is the direct cause of the inventory sentences.

**(b) The model's own initiative.** Article 1 contains "No structure was cleared" — written for a
life with *no build fact in play at all*. Removing the fact would not have stopped it.

The No-Place Rule's validator (`no-place.ts`) already bans building *types* — barn, shed, church,
tower — but not the generic `structure`, `built`, `base`. That is precisely why "a structure raised"
passed validation while "a barn" would have been rejected and retried. Closing (a) without (b)
leaves the failure mode that produced article 1 fully intact.

## 3. Newsdesk changes

**`facts.ts`** — `ObituaryFacts.ordeals` drops `buildsPlaced` from its type. The field stays in the
shared read-model (the life dossier still surfaces it); it simply stops crossing into obituary
facts. Structural removal, not a skipped render: a later edit cannot reintroduce the line by
accident, because the value is not in scope.

**`prompt.ts`** — delete the `- Things built this life: ${o.buildsPlaced}` line.

**`voice.ts`** — add a clause to the voice rules: construction and base-building are never
mentioned, in any form. The codebase's convention is that a content rule is enforced by prompt *and*
validator (the No-Place Rule works this way); this follows it.

**`no-place.ts`** — add to the banned vocabulary: `structure`, `structures`, `tent`, `tents`,
`shelter`, `shelters`, `fence`, `fences`, `wall`, `walls`, `built`, `building`, `buildings`.

⚠️ **`built` and `building` are figurative in ordinary English** ("built a reputation", "building a
case"). Banning them risks a false rejection, which costs one retry, and at `NEWSDESK_MAX_ATTEMPTS`
a permanent failure stub. They are included anyway — the requirement is that building is gone
completely — and the 69-article backfill in §5 is the canary: if `failed` climbs materially, narrow
the list to the concrete nouns and drop the verb forms. This is a deliberate, monitored trade, not
an oversight.

⚠️ **The violation message must stop saying "no-place".** `generate.ts` tells the model its draft
"broke THE NO-PLACE RULE by mentioning <term>". For `built` that is simply false, and the feedback
string is what the retry is steered by — a wrong explanation makes the retry worse, not better.
Reword to name banned subject matter generically.

## 4. Web changes

**`nav.ts`** — a fifth item between Survivors and About: `{ key: "obituaries", href: "/obituaries",
label: "Obituaries" }`, plus an `activeNavKey` branch (`inSection(pathname, "/obituaries")`).

**`tab-bar.tsx`** — the mobile bar swaps **You → Obituaries** for signed-in visitors and *adds*
Obituaries for signed-out ones (4 → 5 tabs; the feed is public). The bar stays at five tabs, so the
existing 320px concern is unchanged rather than made worse.

Dropping the You tab does **not** strand `/you`: `AccountAffordance` (the avatar disc linking there)
sits in the masthead right cluster with **no width gate**, unlike the nav beside it (`hidden …
md:flex`), so it renders at every width. Verified in `header.tsx` before this was accepted.

Label is **"Obits"** on the tab bar and **"Obituaries"** in the nav — matching the existing
"Maps"/"Map" split, where the tab bar already uses the shorter form.

**Footer** — add an Obituaries link, so the surface keeps a route below `md` independent of the tab
bar, the same way About is footer-only on mobile.

## 5. Data: clear and re-run the full history

**Ordering is load-bearing: deploy the code first, then clear.** Clearing before the new rules ship
would regenerate all 69 articles under the old ones.

1. Deploy the release normally (`./deploy/deploy.sh`, **no `--rebuild`** — no migration, no
   projection-shape change).
2. Set `NEWSDESK_SINCE=2026-07-01T00:00:00Z` — before the earliest qualified death (2026-07-11), so
   the sweep covers all of history.
3. `DELETE FROM articles;` — `articles` is **durable** and absent from `REBUILD_TRUNCATE_TABLES`, so
   this is a deliberate one-off data operation, not part of any rebuild.
4. Restart `onelife-newsdesk`. 69 targets drain at `NEWSDESK_BATCH_CAP=10` per 300s tick — roughly
   seven ticks, ~35 minutes. Raising the cap for the backfill shortens it to one or two ticks.
5. Watch `failed` across the backfill, per the §3 canary.

**Safe to re-run:** no notification kind references articles (the notifier has four generators —
account, bans, lives, presence — and `obituary_published` went with the content engine), so
regenerating cannot spam player inboxes. Slugs are headline-derived and will change; nothing links
to the old URLs externally, and the sitemap regenerates from the live rows.

## 6. Testing

- `prompt.ts`: a facts object whose ordeals include builds produces a prompt with no build line.
- `no-place.ts`: each new term is rejected; a gamertag containing one (the existing exemption path)
  still passes.
- `generate.ts`: the retry feedback names the offending term without claiming a place violation.
- `nav.ts`: `/obituaries` and `/obituaries/<slug>` both light the new key; `/` still lights Home
  (the existing exact-match rule).
- `tab-bar.tsx`: signed-in shows Obituaries and not You; signed-out shows Obituaries and Sign in;
  both sets stay at five tabs.

## 7. Out of scope

- Removing `/you` itself. The tab is reallocated; the page and its masthead route stay.
- `buildsPlaced` elsewhere in the read-model — the life dossier is unaffected.
- Any change to the No-Place Rule's existing place/terrain vocabulary.
