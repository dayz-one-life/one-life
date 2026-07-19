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

export type ArticleKind = "obituary" | "birth_notice";
export type FactsSnapshot = Record<string, unknown>;

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
    eligible: (f) => f.causeCategory === "environment" || f.causeCategory === "suicide" },
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

export function eligibleCategories(kind: ArticleKind, facts: FactsSnapshot): ImageCategory[] {
  const menu = kind === "obituary" ? MORGUE_CATEGORIES : NURSERY_CATEGORIES;
  return menu.filter((c) => c.eligible(facts));
}
