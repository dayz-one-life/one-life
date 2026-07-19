// The scene-category menu (spec §4). Categories are RAILS for the scene-writer LLM: code filters
// to facts-eligible entries before prompting, so the model never sees a category it can't use.
// Cause-string gates (vehicle/fall/wolf/bear) are substring predicates over the ADM cause
// vocabulary. As of death-cause fidelity stage 2, the parser emits
// wolf|bear|animal|infected|fall, so the wolf/bear/animal and fall gates are live; the vehicle
// gate stays dormant pending the backfill's entity survey — a gate that never matches simply
// never fires.
//
// causeCategory is a widened union as of the suicide fix: "pvp" | "suicide" | "environment" |
// "unknown". These predicates read it off a Record<string, unknown>, so the compiler will NOT
// flag a missing arm — every gate below states its suicide stance explicitly on purpose.

// Three members as of R5d. Widening this deliberately makes the MENUS / KIND_LABEL Records
// below exhaustive-checked: a missing `news` arm is a compile error, not a silent fallthrough.
export type ArticleKind = "obituary" | "birth_notice" | "news";
export type FactsSnapshot = Record<string, unknown>;

/**
 * The exact fact vocabulary the NEWSROOM gates below read, published as a type so the two sides
 * cannot drift. `news-facts.ts` declares `NewsFacts = NewsImageFacts & {…}`, so a builder that
 * stops emitting one of these fields is a COMPILE error; the `news()` accessor below means a
 * rename here is a compile error in the predicates too.
 *
 * Why this exists: these predicates used to read bare keys off an untyped Record. A mismatch
 * between what the facts builder writes and what a gate reads fails CLOSED and SILENT — the gate
 * simply never fires, the imagery is quietly impoverished, and nothing errors.
 *
 * A `type`, deliberately not an `interface`: an interface has no implicit index signature and so
 * does not assign to `FactsSnapshot`, which would make every typed fixture fail to compile at the
 * call site (the trap `PublishBirthFacts` in birth-pg-store.ts already documents).
 */
export type NewsImageFacts = {
  trigger: "standing_dead" | "long_form";
  map: string;                      // servers.map codename, e.g. "sakhal"
  idleHours: number | null;         // Standing Dead only; null for a Long Form cluster
  timeAliveSeconds: number;         // PLAYTIME of the primary subject — never wall clock
  hitsAbsorbed: number;             // Standing Dead endurance signal; 0 for a Long Form cluster
  lifeNumber: number;               // primary subject's per-map life number
  priors: { livesLived: number; totalKills: number };
  subjectCount: number;
  allFreshSubjects: boolean;
};

/** Typed view of the untyped snapshot for the NEWSROOM gates. `Partial` because the value really
 *  is a jsonb blob at runtime and a legacy or half-written row may be missing anything; the point
 *  of the cast is the COMPILE-time key check, not a runtime guarantee — every read below still
 *  defends itself with `??` or `n()`. */
const news = (f: FactsSnapshot) => f as unknown as Partial<NewsImageFacts>;

export interface ImageCategory {
  slug: string;
  caption: string;      // stored verbatim in articles.image_caption when picked
  example: string;      // shown to the scene-writer as the category's canonical framing
  eligible: (facts: FactsSnapshot) => boolean;
}

const s = (v: unknown) => String(v ?? "").toLowerCase();
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const priors = (f: FactsSnapshot) => (f.priors ?? {}) as { livesLived?: number; totalKills?: number };
const verdictCause = (f: FactsSnapshot) => s((f.verdict as { cause?: unknown } | null | undefined)?.cause);

export const MORGUE_CATEGORIES: ImageCategory[] = [
  { slug: "aftermath", caption: "SCENE OF THE INCIDENT",
    example: "Aftermath, no body: a dropped rusty rifle, an overturned boot filling with rain, an empty jacket in wet grass beside a dead cold campfire in foggy pines.",
    eligible: () => true },
  { slug: "last-known", caption: "LAST KNOWN PHOTO",
    example: "A lone survivor in a worn rain jacket caught mid-stride on a muddy forest road, startled by the camera flash, face partly shadowed under a hood, a hunting rifle slung over one shoulder.",
    eligible: () => true },
  { slug: "vantage", caption: "THE SHOT CAME FROM HERE",
    example: "A wide empty view from a grassy hilltop across a foggy field toward a distant treeline and a lone country road far below, trampled grass in the foreground where someone recently lay prone.",
    // Excludes suicide: asserts a distant shooter who does not exist.
    eligible: (f) => f.causeCategory === "pvp" && f.weapon != null },
  { slug: "witnesses", caption: "WITNESSES DECLINED TO COMMENT",
    example: "Three crows perched on a sagging barbed-wire fence beside scattered survival gear in wet grass, grey drizzle, no people anywhere.",
    eligible: () => true },
  { slug: "memorial", caption: "A MEMORIAL, OF SORTS",
    example: "Two red road flares burning on cracked wet asphalt at night, a dented helmet resting on a wooden fence post beside them, rain streaking through the flash.",
    eligible: () => true },
  { slug: "effects", caption: "RECOVERED EFFECTS",
    example: "An empty rusted food can and a bent spoon lying in wet grass beside a cold campfire ring, a torn empty backpack slumped against a birch stump.",
    // Suicide included deliberately: recovered belongings are the one morgue framing that
    // reports a self-inflicted death without a body, a suspect, or an assigned blame.
    // "unknown" included too: belongings assert no mechanism, so they stay honest for the ~23%
    // of deaths whose cause the record never named.
    eligible: (f) => f.causeCategory === "environment" || f.causeCategory === "suicide" || f.causeCategory === "unknown" },
  { slug: "driver-not-pictured", caption: "DRIVER NOT PICTURED",
    example: "A rust-eaten sedan sits crumpled against a roadside pine in thick fog, driver's door hanging open and one headlight still burning weakly into the drizzle, flash glaring off the wet windshield.",
    eligible: (f) => /vehicle|car|transport|truck/.test(s(f.cause)) },
  { slug: "gravity-undefeated", caption: "GRAVITY REMAINS UNDEFEATED",
    example: "A bent guardrail at a cliff edge shot from above, one dropped glove at the brink and nothing below but fog.",
    eligible: (f) => /fell|fall/.test(s(f.cause)) },
  { slug: "suspect-at-large", caption: "THE SUSPECT REMAINS AT LARGE",
    example: "A lone wolf caught full in the flash at the black edge of a pine treeline at night, eyes shining flat white, staring straight into the lens like a booking photo with no wall to stand against.",
    eligible: (f) => /wolf|bear|animal/.test(s(f.cause)) || verdictCause(f) === "mauled" },
  { slug: "trail-ends-here", caption: "THE TRAIL ENDS HERE",
    example: "A single line of boot prints crosses an empty snowfield and simply stops dead mid-stride in the middle of the frame, fresh snowfall already softening the last print.",
    // Excludes suicide: mystery framing misreports the one unambiguous cause.
    eligible: (f) => f.causeCategory === "unknown" || (f.causeCategory === "environment" && f.map === "sakhal") },
  { slug: "approached-for-comment", caption: "APPROACHED FOR COMMENT",
    example: "A hooded figure fills the frame with a gloved palm thrust at the lens, flash blowing out the hand while the face stays lost in the hood's shadow.",
    // Excludes suicide: there is no suspect to approach.
    eligible: (f) => f.causeCategory === "pvp" && f.killerGamertag != null },
  { slug: "first-aid-attempted", caption: "FIRST AID WAS ATTEMPTED",
    example: "An empty saline bag hangs from a low birch branch like a makeshift IV stand, torn sterile wrappers scattered on the moss below it, harsh flash against the dusk.",
    // Currently includes suicide via the !== "pvp" test. Whether "FIRST AID WAS ATTEMPTED" is the
    // right framing for a self-inflicted death (dignified rescue, or tasteless) is an open owner
    // decision, deliberately deferred — revisit when this news kind becomes image-eligible.
    eligible: (f) => f.causeCategory !== "pvp" },
  { slug: "visibility-factor", caption: "VISIBILITY WAS A FACTOR",
    example: "A night flash detonates against a wall of fog, blowing the frame to grey-white with one bare tree as the only legible shape.",
    // Excludes suicide: never attribute a deliberate act to the weather.
    eligible: (f) => f.causeCategory === "environment" || f.causeCategory === "unknown" },
  { slug: "worldly-possessions", caption: "ALL WORLDLY POSSESSIONS, PICTURED",
    example: "Two cupped gloved hands filling the frame in close macro under hard flash, holding the complete estate: one rag, one road flare, one bruised plum.",
    eligible: (f) => f.freshSpawnVictim === true },
  { slug: "pacifists-garden", caption: "NOT ONE SHOT FIRED",
    example: "A hand-tended vegetable plot behind a shed in the rain, a fishing rod propped against the fence and a watering can tipped on its side — everything neat, everything soaked, no weapon anywhere in frame.",
    eligible: (f) => n(f.kills) === 0 && (n(f.timeAliveSeconds) ?? 0) >= 86_400 },
  { slug: "construction-halted", caption: "CONSTRUCTION HALTED INDEFINITELY",
    example: "The skeletal frame of a half-built log watchtower against a grey sky, a hammer still wedged in a joint and the ladder leaning where it was left.",
    eligible: (f) => (n(f.timeAliveSeconds) ?? 0) >= 604_800 },
];

export const NURSERY_CATEGORIES: ImageCategory[] = [
  { slug: "ashore", caption: "FIRST KNOWN PHOTO",
    example: "A soaking-wet man stumbling out of grey surf onto a rocky beach at cold dawn, clutching a lit red road flare, lost and terrified.",
    eligible: () => true },
  { slug: "inland", caption: "LAST SEEN HEADING INLAND",
    example: "A tiny distant figure walking alone up a wet coastal road away from the camera at cold dawn, sea mist rolling in behind them.",
    eligible: () => true },
  { slug: "loot", caption: "MOMENTS AFTER ARRIVAL",
    example: "A startled survivor caught by the flash elbow-deep in the open trunk of a rusted abandoned car at dusk, glancing back over their shoulder like a burglar.",
    eligible: () => true },
  { slug: "fire", caption: "DAY ONE",
    example: "A drenched survivor crouched over a tiny struggling campfire in drizzle at the edge of a pine forest, hands stretched toward the weak flame.",
    eligible: () => true },
  { slug: "stare", caption: "BACK AGAIN",
    example: "A close flash portrait of a soaked survivor with matted hair staring straight into the camera with a weary thousand-yard expression, dark pine forest behind.",
    eligible: (f) => (priors(f).livesLived ?? 0) > 0 },
  { slug: "pictured-optimism", caption: "PICTURED: OPTIMISM",
    example: "A lone figure stands silhouetted on a ridgeline against a thin, unpromising dawn, fists on hips like a founder surveying holdings, unaware of the camera below.",
    eligible: () => true },
  { slug: "christening", caption: "THE CHRISTENING",
    example: "A figure kneeling at the lip of a scummy green pond, flash freezing the water mid-drip as they raise cupped hands to drink, hood down, utterly at peace.",
    eligible: () => true },
  { slug: "many-happy-returns", caption: "MANY HAPPY RETURNS",
    example: "A single lit road flare planted upright in an opened tin can on a bare wooden table, sputtering pink light against the flash, staged like the world's grimmest birthday cake.",
    eligible: (f) => (n(f.lifeNumber) ?? 0) >= 5 },
  { slug: "slow-burner", caption: "STRATEGY, REPORTEDLY",
    example: "The flash catching a pair of wary eyes deep inside a roadside bush, the rest of the crouched figure swallowed by wet leaves.",
    eligible: (f) => (n(f.minutesToQualify) ?? 0) >= 60 },
  { slug: "residents-advised", caption: "RESIDENTS HAVE BEEN ADVISED",
    example: "A distant figure standing perfectly still in the middle of a dirt road at dusk, facing the camera, far too far away to identify.",
    eligible: (f) => f.isKnownQuantity === true && (priors(f).totalKills ?? 0) >= 20 },
  { slug: "adverse-conditions", caption: "CONDITIONS AT BIRTH: ADVERSE",
    example: "A lone hooded figure wades knee-deep through a white-out snowfield, the flash lighting up every falling snowflake into a wall of bright dots between camera and subject.",
    eligible: (f) => f.map === "sakhal" },
  { slug: "big-plans", caption: "BIG PLANS",
    example: "A lone figure hunched over an unfolded, rain-ruined, illegibly blurred map spread on a rusted car hood at night, flash catching their breath in the cold air, one finger planted on a spot with total unearned confidence.",
    eligible: () => true },
  { slug: "first-contact", caption: "FIRST CONTACT",
    example: "A fresh spawn stands frozen in a wet pasture, one hand cautiously extended toward an unimpressed dairy cow that fills the other half of the frame.",
    eligible: (f) => (priors(f).livesLived ?? 0) === 0 },
];

// The Newsroom menu (R5d). The facts vocabulary these gates read is the NewsImageFacts type
// above — not a comment. Every gate reads it through the typed `news()` accessor, so a rename on
// either side is a compile error rather than a gate that silently stops firing.
//
// `lastExpressiveEmote` is NOT part of the contract: the expressive-emote allowlist covers ~49
// events corpus-wide (no signal), and reaching it means querying events.payload — the same column
// that holds 5,633 coordinate rows the Fog Rule exists to keep off this boundary.
//
// FOG RULE, STRICTER HERE (spec §4.1.4): a Standing Dead subject is ALIVE and non-consenting.
// No framing may imply a death, a position fix, a route, or a recognisable locale. Favour
// absence and vacancy — the story is that nobody came back, not that somebody died.
export const NEWSROOM_CATEGORIES: ImageCategory[] = [
  { slug: "unattended-camp", caption: "NOBODY CAME BACK FOR THIS",
    example: "A small abandoned camp in wet pine woods at dusk: a collapsed tarp shelter, a cold fire ring gone to grey ash, an enamel mug still upright on a flat stone, nothing living anywhere in frame.",
    // Standing Dead only: vacancy is the whole story. Never offered to Long Form, where a
    // deserted camp would read as the aftermath of a death that happened somewhere else.
    eligible: (f) => news(f).trigger === "standing_dead" },
  { slug: "unslept-bedroll", caption: "THE BED WAS NEVER SLEPT IN",
    example: "A rolled sleeping bag lying flat and unopened on bare floorboards in a derelict wooden room, one boot tipped over beside it, grey light through a broken window and drifted dust across everything.",
    eligible: (f) => news(f).trigger === "standing_dead" },
  { slug: "no-forwarding-address", caption: "NO FORWARDING ADDRESS",
    example: "An empty dirt crossroads in flat farmland under low grey cloud, a leaning wooden signpost with both arms snapped off, tyre ruts filling with rain and no traffic in either direction.",
    // Deliberately signless and directionless: an intact sign would name a place and break the
    // Fog Rule for a subject who is alive and locatable.
    eligible: () => true },
  { slug: "the-regular", caption: "A KNOWN FACE, RECENTLY ABSENT",
    example: "A worn canvas jacket hanging alone on a nail in an empty wooden hallway, shoulders shaped by long use, a shut door beyond it and no one in frame.",
    // Priors gate: this framing asserts a history. A first-lifer has none, and the Standing Dead
    // predicate already refuses to cover one without earned coverage. Standing Dead only: the
    // caption asserts the subject is "recently absent" (alive, unattended), which is false for a
    // Long Form death — `priors` there is the primary subject's, so a Long Form primary with any
    // prior life would otherwise fire this gate on a death piece.
    eligible: (f) => (news(f).priors?.livesLived ?? 0) >= 1 && news(f).trigger === "standing_dead" },
  { slug: "what-it-took", caption: "WHAT IT TOOK TO GET THIS FAR",
    example: "A stack of spent bandages, a bloodied rag and three empty saline bottles heaped on a scuffed table under a bare bulb, flash glaring off the wet glass.",
    // Endurance gate mirrors the earned-coverage clause (hitsAbsorbed >= 100). Objects only —
    // no wound, no body, and nothing that implies the subject stopped surviving.
    eligible: (f) => (n(news(f).hitsAbsorbed) ?? 0) >= 100 },
  { slug: "last-transmission", caption: "LAST RECORDED TRANSMISSION",
    example: "A battered handheld radio lying face-up in wet grass beside a fallen birch, its dial glowing faintly, nobody holding it and nothing but drizzle in the background.",
    eligible: () => true },
  { slug: "still-listed", caption: "STILL LISTED AS ACTIVE",
    example: "A rain-warped paper pinned to a rotting noticeboard, its writing washed to illegible grey smears, one dog-eared corner lifting in the wind under an overcast sky.",
    // Illegible by construction: no legible text is a hard rail, and this framing is the one
    // most likely to tempt the model into writing a name.
    eligible: () => true },
  { slug: "long-idle", caption: "SOME TIME HAS PASSED",
    example: "A rusted metal gate standing half open across a muddy farm track, grass grown thick and undisturbed through the gap where it has not swung in weeks, thin fog in the treeline behind.",
    // Idle framing only fires once the absence is genuinely long, so the photo can't out-claim
    // the copy. 72h is the trigger floor; this wants visibly more.
    eligible: (f) => (n(news(f).idleHours) ?? 0) >= 120 },
  { slug: "two-sets-of-tracks", caption: "TWO SETS OF TRACKS, ONE DIRECTION",
    example: "Two lines of bootprints pressed into wet mud along a forest verge, converging and then ending at a churned patch of grass, no figures anywhere and rain filling the deeper prints.",
    // Long Form only: a convergence framing. Applied to a lone Standing Dead subject it would
    // invent a companion who does not exist.
    eligible: (f) => news(f).trigger === "long_form" },
  { slug: "same-minute", caption: "WITHIN THE SAME MINUTE",
    example: "Two dropped backpacks lying a few metres apart in long wet grass at the edge of a clearing, both still open, rain beading on the canvas, nothing else in the frame.",
    // Objects at a distance from each other carry the coincidence without a corpse or a fix.
    eligible: (f) => news(f).trigger === "long_form" && (n(news(f).subjectCount) ?? 0) >= 2 },
  { slug: "the-world-did-this", caption: "THE WORLD DID THIS, NOT THEM",
    example: "A wide flat view of an empty rain-soaked field under a heavy pressing sky, a single leafless tree off-centre and a treeline dissolving into fog at the far edge.",
    // The fresh-subject tone branch: when every subject is a first-lifer the story is the world,
    // never the two men's competence. Punch up, never down.
    eligible: (f) => news(f).trigger === "long_form" && news(f).allFreshSubjects === true },
  { slug: "conditions-noted", caption: "CONDITIONS WERE NOTED",
    example: "Driving snow across a bare white slope at dusk, the flash lighting every falling flake into a wall of bright dots, a line of fence posts vanishing into the whiteout.",
    // Weather framing is honest for Sakhal and nowhere else — this is the one map cue the Fog
    // Rule permits, because the map is already in the dateline.
    eligible: (f) => news(f).map === "sakhal" },
  { slug: "the-desk-has-questions", caption: "THE DESK HAS QUESTIONS",
    example: "A cluttered corner of a derelict room lit hard by flash: an overturned wooden chair, a tin cup on its side, a single muddy bootprint on bare boards, and no one to explain any of it.",
    eligible: () => true },
];

// Keyed lookup, not a ternary: the old `kind === "obituary" ? MORGUE : NURSERY` handed every
// non-obituary kind the Nursery menu, so news photos would all be fresh-spawn framings.
const MENUS: Record<ArticleKind, ImageCategory[]> = {
  obituary: MORGUE_CATEGORIES,
  birth_notice: NURSERY_CATEGORIES,
  news: NEWSROOM_CATEGORIES,
};

export function eligibleCategories(kind: ArticleKind, facts: FactsSnapshot): ImageCategory[] {
  // A Record lookup does NOT throw on a miss — TS types this as ImageCategory[] while the
  // runtime yields undefined for any key outside the union, and image-pg-store.ts casts a raw
  // db `text` column into ArticleKind unchecked. Without this guard, `.filter` on undefined is
  // an opaque TypeError inside imageTick's try/catch that burns an image_attempts retry.
  // Precedent: buildImagePrompt's `if (!ratio) throw new Error(`unknown image kind: ${kind}`)`.
  const menu = MENUS[kind];
  if (!menu) throw new Error(`no image category menu for article kind: ${kind}`);
  return menu.filter((c) => c.eligible(facts));
}
