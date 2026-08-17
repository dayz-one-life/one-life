/**
 * Client-side half of the minimum-supported-version gate.
 *
 * Once the mobile app is on someone's phone, old versions call the API indefinitely — including
 * from users who never update. The API publishes a per-platform floor (`GET /api/app-version`)
 * and the app compares its own version against it at launch, showing a blocking "update
 * required" screen when it falls below.
 *
 * Lives here rather than in the app because it needs real tests and, when `apps/mobile` lands,
 * it is the app's very first call — a bug here is not fixable by an update, since the user
 * cannot get past the screen that tells them to update.
 */

/** Parse "1.2.3" into [1, 2, 3]. Returns null for anything that is not a leading number. */
function parse(version: string): [number, number, number] | null {
  // Drop a `-prerelease` or `+build` suffix: the numeric triple is the whole ordering here.
  // Two builds of the same version are the same version for gate purposes.
  const core = version.trim().split(/[-+]/)[0] ?? "";
  if (core === "") return null;
  const parts = core.split(".");
  if (parts.length > 3) return null;
  const nums: number[] = [];
  for (const p of parts) {
    // Deliberately strict: `Number("")` is 0 and `parseInt("1abc")` is 1, both of which would
    // silently accept junk and produce a confident wrong answer.
    if (!/^\d+$/.test(p)) return null;
    nums.push(Number(p));
  }
  // Missing trailing segments are zero, so "1.2" and "1.2.0" compare equal.
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
}

/**
 * Compare two dotted numeric versions. Returns 1 if `a` is newer, -1 if older, 0 if equal.
 * Throws on unparseable input — callers that must not fail closed use `isUpdateRequired`.
 */
export function compareVersions(a: string, b: string): 1 | 0 | -1 {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) throw new Error(`compareVersions: unparseable version (${a!}, ${b!})`);
  for (let i = 0; i < 3; i++) {
    // Numeric, not lexical: "1.10.0" is newer than "1.9.0" even though it sorts before it.
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * Should this app version be blocked with an "update required" screen?
 *
 * ⚠️ FAILS OPEN, always. If either version is missing or unparseable this returns `false`.
 * A gate that fails closed on a typo'd env var locks every user of a shipped app behind an
 * update wall for a release that does not exist — recoverable only by an API deploy, and only
 * after someone notices. Being too permissive costs nothing by comparison: the gate is a UX
 * affordance telling an honest client to update, not a security boundary.
 */
export function isUpdateRequired(appVersion: string, minimumVersion: string | undefined): boolean {
  if (!minimumVersion) return false;
  if (!parse(appVersion) || !parse(minimumVersion)) return false;
  return compareVersions(appVersion, minimumVersion) < 0;
}
