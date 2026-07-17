# R3 Controls Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the whole account surface (/account, /account/claim, status banner, masthead slot) with the tabloid controls rail (desktop) + pill/bottom-sheet (mobile), plus the R3 cleanup: gamertag-based transfer/referrer API, login restyle, legacy-token deletion, `tint`→`bone` rename, serverId fix redo, and the R1/R2 carried-forward consolidation.

**Architecture:** Root layout gains an `xl:` two-column grid (`minmax(0,1fr)` main + 380px rail); all pages are untouched children of the main column. One `useControls()` data hook + one `useControlsActions()` mutations hook feed three surfaces (rail, pill, sheet) driven by the existing `accountStatus` union. Presentational components live in `apps/web/src/components/controls/` and are props-only + unit-tested; containers are thin.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v3 (RGB-triple tokens), TanStack Query, Vitest 2 + Testing Library, Fastify + Zod (API), Drizzle (API route lookup only).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-r3-controls-rail-design.md`. Design canvas rounds 10a–d.
- **New tokens only.** Never use legacy classes `bg/panel/panel-2/line/bone(legacy alias)/dim/muted/wash/amber/blood/steel` or `font-hand` in new code. Allowed: `paper ink red red-deep yellow blue tint(→bone after Task 12) dark hairline hairline-2 archive dark-line dash ink-soft ink-muted cream-muted cream-dim red-soft discord`. Arbitrary values allowed only for canvas one-offs already named in this plan (`#111`, `#1A1A12`, `#6A6852`, `#4A4838`, shadows).
- **Copy is verbatim and states real mechanics** (sentence case in source; CSS `uppercase` does the shouting): `SEND TO VERIFIED PLAYER…` placeholder, `+1 every 1st of the month · Transfers are final`, `We suggest tags seen on our servers. Verifying earns 1 token.` (**1**, not the canvas's 2), `The Xbox gamertag you play under. One per account.`, `On any One Life server. Other emotes between are fine — order is what counts. Only whoever controls the tag can finish this.`, `Spawn in any time. First 5 minutes are free.`, `Spend 1 token — skip the wait`, `Get in the paper.`, `Player controls`, `No active life`. No exclamation points, no emoji.
- **Voice-first:** no links to teaser pages from the rail; the banned card's `Obituary →` goes to the player's own dossier.
- Tests use explicit vitest imports (`import { describe, expect, test } from "vitest"` — `it` also fine) and Testing Library. Presentational components tested by props; thin hook wrappers/containers untested.
- Decorative images/discs: `aria-hidden` or `alt=""`, never `role="img"`. Tap targets ≥44px for primary controls.
- Web tests: `pnpm --filter web test -- run <file>` (vitest). API tests need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test`. Full suite: `pnpm turbo run test --concurrency=1`; typecheck: `pnpm turbo run typecheck`.
- Commit after every task; message style `feat(web): …` / `fix(api): …` / `refactor(web): …`.
- Branch: `feature/r3-controls-rail`.

---

### Task 1: Gamertag-based transfer + referrer (API + web client)

**Files:**
- Modify: `apps/api/src/routes/tokens.ts`
- Modify: `apps/api/test/tokens-routes.test.ts`
- Modify: `apps/web/src/lib/api.ts` (transferToken/setReferrer only)

**Interfaces:**
- Produces: `POST /me/tokens/transfer` body `{ toGamertag: string }`; `POST /me/referrer` body `{ referrerGamertag: string }`. Unknown/unverified gamertag → `400 { error: "not_verified" }`. Web: `transferToken(toGamertag: string)`, `setReferrer(referrerGamertag: string)` (same arity, new body keys).

- [ ] **Step 1: Write failing route tests**

In `apps/api/test/tokens-routes.test.ts`, find the referrer test (`set-referrer 400s (not_verified) for an unknown referrer`, payload `{ referrerUserId: "ghost-user" }`) and change its payload to `{ referrerGamertag: "GhostNobody999" }`. Then add these tests in the same `describe` block, reusing the file's existing `app`, `cookie`, `db`, `svc` helpers (create the counterparty inline):

```ts
it("transfers a token by gamertag, case-insensitively", async () => {
  const otherId = `tok-other-${svc}`;
  await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
            VALUES (${otherId}, 'Other', ${`other${svc}@example.com`}, true, now(), now())`;
  await db.insert(gamertagLinks).values({ userId: otherId, gamertag: `OtherGT${svc}`, status: "verified" });

  const res = await app.inject({
    method: "POST", url: "/me/tokens/transfer",
    headers: { cookie, "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { toGamertag: `othergt${svc}` }, // lower-cased on purpose
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });

  // cleanup so the sender's balance assertions elsewhere stay valid is not needed —
  // this suite creates its own grants; just remove the counterparty rows.
  await sql`DELETE FROM token_transactions WHERE user_id = ${otherId}`;
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, otherId));
  await sql`DELETE FROM "user" WHERE id = ${otherId}`;
});

it("transfer 400s (not_verified) for an unknown gamertag", async () => {
  const res = await app.inject({
    method: "POST", url: "/me/tokens/transfer",
    headers: { cookie, "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { toGamertag: "NobodyEver999" },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toEqual({ error: "not_verified" });
});
```

Notes: the transfer spends 1 token — if a later balance assertion in the file assumed an untouched balance, adjust it (read the file; the suite grants via `grant(...)` in `beforeAll`). If the sender has 0 tokens at that point, `grant` one more in the new test before injecting (idempotencyKey `transfer-test:${svc}`), and assert the final state accordingly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/api test -- run test/tokens-routes.test.ts`
Expected: FAIL — Zod rejects `toGamertag`/`referrerGamertag` (400 with a Zod error, not `{ok:true}`/`not_verified`).

- [ ] **Step 3: Implement the route change**

In `apps/api/src/routes/tokens.ts`:

```ts
// imports: add
import { gamertagLinks } from "@onelife/db";
import { and, desc, eq, sql as dsql } from "drizzle-orm"; // keep existing imports; add and/eq/dsql as needed

// body schemas: replace
const transferBody = z.object({ toGamertag: z.string().min(1) });
const referrerBody = z.object({ referrerGamertag: z.string().min(1) });

// helper (top level, after schemas)
/** Resolve a gamertag to its verified owner's userId; null when nobody verified holds it. */
async function verifiedUserIdByGamertag(db: Database, gamertag: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: gamertagLinks.userId })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.status, "verified"), dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`))
    .limit(1);
  return row?.userId ?? null;
}
```

Transfer handler body becomes:

```ts
    const body = transferBody.parse(req.body);
    const toUserId = await verifiedUserIdByGamertag(db, body.toGamertag);
    if (!toUserId) return reply.code(400).send({ error: "not_verified" });
    try {
      await transfer(db, { fromUserId: session.user.id, toUserId });
      return { ok: true };
    } catch (e) {
      return onTokenError(e, reply);
    }
```

Referrer handler body becomes:

```ts
    const body = referrerBody.parse(req.body);
    const referrerUserId = await verifiedUserIdByGamertag(db, body.referrerGamertag);
    if (!referrerUserId) return reply.code(400).send({ error: "not_verified" });
    try {
      await setReferrer(db, { userId: session.user.id, referrerUserId });
      return { ok: true };
    } catch (e) {
      return onTokenError(e, reply);
    }
```

(If the file already imports `sql` from drizzle-orm under another name, follow the file's existing import style.)

- [ ] **Step 4: Update the web client**

In `apps/web/src/lib/api.ts` replace the two functions:

```ts
export const transferToken = (toGamertag: string) =>
  apiSend<{ ok: true }>("POST", "/api/me/tokens/transfer", { toGamertag });
export const setReferrer = (referrerGamertag: string) =>
  apiSend<{ ok: true }>("POST", "/api/me/referrer", { referrerGamertag });
```

(The old `/account` page still compiles — both functions keep a single string arg.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/api test -- run test/tokens-routes.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/tokens.ts apps/api/test/tokens-routes.test.ts apps/web/src/lib/api.ts
git commit -m "feat(api): transfer + referrer resolve verified gamertags instead of raw user ids"
```

---

### Task 2: Controls format helpers (`pillStatus`, `serverCards`, labels)

**Files:**
- Create: `apps/web/src/components/controls/format.ts`
- Test: `apps/web/src/components/controls/format.test.ts`

**Interfaces:**
- Consumes: `formatDuration`, `banCountdown`, `mapLabel` from `@/components/player/format`; `AccountStatus` from `@/lib/account-status`; `Server`, `ServerStanding` from `@/lib/types`.
- Produces (used by Tasks 4–9):
  - `type PillTone = "red" | "yellow" | "dim" | "muted"`; `type PillLine = { text: string; tone: PillTone }`
  - `type ServerCardData = { slug: string; map: string; state: "alive" | "banned" | "idle"; alive: { timeAliveSeconds: number; kills: number } | null; ban: { banId: number; bannedAt: string; expiresAt: string | null; liftPending: boolean } | null }`
  - `initialOf(name: string): string`
  - `diedAtLabel(bannedAt: string): string` — local `HH:MM`
  - `serverCards(servers: Server[], standing: ServerStanding[]): ServerCardData[]`
  - `serverFactLine(card: ServerCardData): string`
  - `transferErrorLabel(code: string): string`
  - `pillStatus(status: AccountStatus, cards: ServerCardData[], now: Date): PillLine`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/controls/format.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { AccountStatus } from "@/lib/account-status";
import type { Server, ServerStanding } from "@/lib/types";
import {
  diedAtLabel, initialOf, pillStatus, serverCards, serverFactLine, transferErrorLabel,
} from "./format";

const NOW = new Date("2026-07-16T12:00:00Z");

const server = (over: Partial<Server>): Server => ({
  id: 1, nitradoServiceId: 1, name: "s", map: "chernarusplus", slug: "chernarus",
  active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z", ...over,
});

const standing = (over: Partial<ServerStanding>): ServerStanding => ({
  serverId: 1, map: "chernarusplus", slug: "chernarus", state: "idle",
  character: null, alive: null, ban: null, ...over,
});

const aliveStanding = (slug: string, map: string, secs: number, kills = 0): ServerStanding =>
  standing({
    slug, map, state: "alive",
    alive: { lifeId: 1, startedAt: "2026-07-16T05:00:00Z", timeAliveSeconds: secs, kills, longestKillMeters: null, killList: [] },
  });

const bannedStanding = (slug: string, map: string, expiresAt: string | null): ServerStanding =>
  standing({
    slug, map, state: "banned",
    ban: { banId: 9, bannedAt: "2026-07-16T09:47:00Z", expiresAt, liftPending: false, triggeringLifeNumber: 1 },
  });

const VERIFIED: AccountStatus = { kind: "verified", link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null } };

describe("initialOf", () => {
  test("uppercases the first character", () => expect(initialOf("boots")).toBe("B"));
  test("falls back on empty input", () => expect(initialOf("  ")).toBe("?"));
});

describe("diedAtLabel", () => {
  test("renders zero-padded local HH:MM", () => {
    const d = new Date("2026-07-16T09:47:00Z");
    const expected = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(diedAtLabel("2026-07-16T09:47:00Z")).toBe(expected);
  });
});

describe("serverCards", () => {
  test("one card per active slugged server; unmatched servers are idle", () => {
    const cards = serverCards(
      [server({ id: 1, slug: "chernarus", map: "chernarusplus" }), server({ id: 2, slug: "sakhal", map: "sakhal" }), server({ id: 3, slug: null })],
      [aliveStanding("chernarus", "chernarusplus", 22920, 0)],
    );
    expect(cards.map((c) => [c.slug, c.state])).toEqual([["chernarus", "alive"], ["sakhal", "idle"]]);
  });
});

describe("serverFactLine", () => {
  test("alive line has time and pluralized kills", () => {
    const [c] = serverCards([server({})], [aliveStanding("chernarus", "chernarusplus", 22920, 1)]);
    expect(serverFactLine(c!)).toBe("Qualified · 6h 22m this life · 1 kill");
  });
  test("idle line is the grace invitation", () => {
    const [c] = serverCards([server({})], []);
    expect(serverFactLine(c!)).toBe("Spawn in any time. First 5 minutes are free.");
  });
  test("banned line is the died-at stamp", () => {
    const [c] = serverCards([server({})], [bannedStanding("chernarus", "chernarusplus", null)]);
    expect(serverFactLine(c!)).toBe(`Died ${diedAtLabel("2026-07-16T09:47:00Z")}`);
  });
});

describe("transferErrorLabel", () => {
  test("maps the API codes", () => {
    expect(transferErrorLabel("not_verified")).toBe("Not a verified player");
    expect(transferErrorLabel("insufficient_tokens")).toBe("Not enough tokens");
    expect(transferErrorLabel("self_transfer")).toBe("That's you");
    expect(transferErrorLabel("already_set")).toBe("Already set");
    expect(transferErrorLabel("boom")).toBe("Something went wrong");
  });
});

describe("pillStatus", () => {
  test("banned beats everything; soonest lift wins; tone red", () => {
    const cards = serverCards(
      [server({ id: 1, slug: "chernarus", map: "chernarusplus" }), server({ id: 2, slug: "sakhal", map: "sakhal" })],
      [bannedStanding("sakhal", "sakhal", "2026-07-17T01:58:00Z"), aliveStanding("chernarus", "chernarusplus", 100)],
    );
    expect(pillStatus(VERIFIED, cards, NOW)).toEqual({ text: "Sakhal ban lifts in 13h 58m", tone: "red" });
  });
  test("pending shows emote progress in yellow", () => {
    const st: AccountStatus = { kind: "pending", link: { id: 1, gamertag: "Boots", status: "pending", verifiedAt: null, challenge: { sequence: ["facepalm", "salute", "clap"], progressIndex: 1, expiresAt: "2026-07-17T00:00:00Z", expired: false } } };
    expect(pillStatus(st, [], NOW)).toEqual({ text: "Verify: 1/3 done", tone: "yellow" });
  });
  test("expired pending says so", () => {
    const st: AccountStatus = { kind: "pending", link: { id: 1, gamertag: "Boots", status: "pending", verifiedAt: null, challenge: { sequence: ["facepalm"], progressIndex: 0, expiresAt: "2026-07-15T00:00:00Z", expired: true } } };
    expect(pillStatus(st, [], NOW)).toEqual({ text: "Verification expired", tone: "yellow" });
  });
  test("unlinked invites the link", () => {
    expect(pillStatus({ kind: "unlinked" }, [], NOW)).toEqual({ text: "Link your gamertag →", tone: "dim" });
  });
  test("alive shows the longest-lived life in dim", () => {
    const cards = serverCards(
      [server({ id: 1, slug: "chernarus", map: "chernarusplus" }), server({ id: 2, slug: "sakhal", map: "sakhal" })],
      [aliveStanding("chernarus", "chernarusplus", 100), aliveStanding("sakhal", "sakhal", 22920)],
    );
    expect(pillStatus(VERIFIED, cards, NOW)).toEqual({ text: "Sakhal · 6h 22m this life", tone: "dim" });
  });
  test("verified with nothing going on: no active life, muted", () => {
    const cards = serverCards([server({})], []);
    expect(pillStatus(VERIFIED, cards, NOW)).toEqual({ text: "No active life", tone: "muted" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- run src/components/controls/format.test.ts`
Expected: FAIL — module `./format` not found.

- [ ] **Step 3: Implement**

`apps/web/src/components/controls/format.ts`:

```ts
import type { AccountStatus } from "@/lib/account-status";
import type { Server, ServerStanding } from "@/lib/types";
import { banCountdown, formatDuration, mapLabel } from "@/components/player/format";

export type PillTone = "red" | "yellow" | "dim" | "muted";
export type PillLine = { text: string; tone: PillTone };

/** First letter of a display name for the avatar disc. */
export function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/** Local HH:MM time-of-death, taken from the ban timestamp (bans are cut on death). */
export function diedAtLabel(bannedAt: string): string {
  const d = new Date(bannedAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** One rail card per active slugged server, merged with the viewer's standing by slug. */
export type ServerCardData = {
  slug: string;
  map: string;
  state: "alive" | "banned" | "idle";
  alive: { timeAliveSeconds: number; kills: number } | null;
  ban: { banId: number; bannedAt: string; expiresAt: string | null; liftPending: boolean } | null;
};

export function serverCards(servers: Server[], standing: ServerStanding[]): ServerCardData[] {
  return servers
    .filter((s): s is Server & { slug: string } => s.slug !== null)
    .map((s) => {
      const st = standing.find((x) => x.slug === s.slug);
      return {
        slug: s.slug,
        map: s.map,
        state: st?.state ?? "idle",
        alive: st?.alive ? { timeAliveSeconds: st.alive.timeAliveSeconds, kills: st.alive.kills } : null,
        ban: st?.ban
          ? { banId: st.ban.banId, bannedAt: st.ban.bannedAt, expiresAt: st.ban.expiresAt, liftPending: st.ban.liftPending }
          : null,
      };
    });
}

/** The mono fact line under a server card's name (CSS uppercases it). */
export function serverFactLine(card: ServerCardData): string {
  if (card.state === "alive" && card.alive) {
    return `Qualified · ${formatDuration(card.alive.timeAliveSeconds)} this life · ${card.alive.kills} kill${card.alive.kills === 1 ? "" : "s"}`;
  }
  if (card.state === "banned" && card.ban) return `Died ${diedAtLabel(card.ban.bannedAt)}`;
  return "Spawn in any time. First 5 minutes are free.";
}

/** User-facing label for token-panel API error codes. */
export function transferErrorLabel(code: string): string {
  if (code === "not_verified") return "Not a verified player";
  if (code === "insufficient_tokens") return "Not enough tokens";
  if (code === "self_transfer") return "That's you";
  if (code === "already_set") return "Already set";
  return "Something went wrong";
}

/** The pill's one status line, most urgent first: banned > pending > unlinked > alive > idle. */
export function pillStatus(status: AccountStatus, cards: ServerCardData[], now: Date): PillLine {
  const banned = cards.filter((c) => c.state === "banned" && c.ban);
  if (banned.length > 0) {
    const soonest = banned
      .slice()
      .sort((a, b) => new Date(a.ban!.expiresAt ?? 0).getTime() - new Date(b.ban!.expiresAt ?? 0).getTime())[0]!;
    const cd = banCountdown(soonest.ban!.expiresAt, now);
    return { text: cd ? `${mapLabel(soonest.map)} ban lifts in ${cd}` : `${mapLabel(soonest.map)} banned`, tone: "red" };
  }
  if (status.kind === "pending") {
    const ch = status.link.challenge;
    if (ch && !ch.expired) return { text: `Verify: ${ch.progressIndex}/${ch.sequence.length} done`, tone: "yellow" };
    return { text: "Verification expired", tone: "yellow" };
  }
  if (status.kind === "unlinked") return { text: "Link your gamertag →", tone: "dim" };
  const alive = cards.filter((c) => c.state === "alive" && c.alive);
  if (alive.length > 0) {
    const longest = alive.slice().sort((a, b) => b.alive!.timeAliveSeconds - a.alive!.timeAliveSeconds)[0]!;
    return { text: `${mapLabel(longest.map)} · ${formatDuration(longest.alive!.timeAliveSeconds)} this life`, tone: "dim" };
  }
  return { text: "No active life", tone: "muted" };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- run src/components/controls/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls/format.ts apps/web/src/components/controls/format.test.ts
git commit -m "feat(web): controls format helpers — pill status, server-card merge, error labels"
```

---

### Task 3: Shared unban state + SelfUnbanButton on react-query

**Files:**
- Modify: `apps/web/src/components/player/self-unban-button.tsx`
- Modify: `apps/web/src/components/player/self-unban-button.test.tsx`

**Interfaces:**
- Produces: `unbanStateOf(liftPending: boolean, balance: number): UnbanState` exported from `@/components/player/self-unban-button` (alongside the existing `UnbanView`, `UnbanState`). `SelfUnbanButton` now reads the balance from the shared TanStack cache (`queryKey: ["tokens"]`) instead of a private `useEffect` fetch — the rail (Task 8) shares that cache.

- [ ] **Step 1: Write the failing test**

Append to the `describe` in `apps/web/src/components/player/self-unban-button.test.tsx` (add `unbanStateOf` to the import):

```tsx
test("unbanStateOf: pending wins, then balance decides", () => {
  expect(unbanStateOf(true, 5)).toBe("pending");
  expect(unbanStateOf(false, 2)).toBe("ready");
  expect(unbanStateOf(false, 0)).toBe("no-tokens");
});
```

Also rename the stale test `"renders nothing when not owner"` → `"renders nothing in the hidden state"` (it exercises `UnbanView state="hidden"`, not ownership).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- run src/components/player/self-unban-button.test.tsx`
Expected: FAIL — `unbanStateOf` is not exported.

- [ ] **Step 3: Implement**

In `apps/web/src/components/player/self-unban-button.tsx`:

1. Add the pure helper (export it):

```ts
/** Shared unban CTA state: lift already pending > has tokens > broke. */
export function unbanStateOf(liftPending: boolean, balance: number): UnbanState {
  return liftPending ? "pending" : balance > 0 ? "ready" : "no-tokens";
}
```

2. Replace the `useEffect`/`useState(tokens)` balance fetch in `SelfUnbanButton` with the shared query, and derive state via the helper. Full new `SelfUnbanButton`:

```tsx
export function SelfUnbanButton({
  banId,
  pageGamertag,
  liftPending,
}: {
  banId: number;
  pageGamertag: string;
  liftPending: boolean;
}) {
  const { data: session } = useSession();
  const links = useGamertagLinks(!!session?.user);
  const link = activeLink(links.data);
  const isOwner = !!session?.user && link?.status === "verified" && link.gamertag === pageGamertag;
  const [pending, setPending] = useState(liftPending);
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: getTokens, enabled: isOwner });

  if (!isOwner) return <UnbanView state="hidden" balance={0} onRedeem={() => {}} />;

  const balance = tokens.data?.balance ?? 0;
  const state = unbanStateOf(pending, balance);
  const onRedeem = async () => {
    setPending(true);
    try {
      await redeemToken(banId);
    } catch {
      setPending(false);
    }
  };
  return <UnbanView state={state} balance={balance} onRedeem={onRedeem} />;
}
```

Imports: replace `useEffect` import with `useState` only; add `import { useQuery } from "@tanstack/react-query";` and keep `getTokens, redeemToken` from `@/lib/api`. Remove the now-unused `useEffect` block entirely. `UnbanView` is unchanged.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- run src/components/player/self-unban-button.test.tsx`
Expected: PASS (helper + renamed test; UnbanView tests untouched).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/self-unban-button.tsx apps/web/src/components/player/self-unban-button.test.tsx
git commit -m "refactor(web): self-unban balance via shared tokens query + exported unbanStateOf"
```

---

### Task 4: `useModalBehavior` + mobile-menu retrofit

**Files:**
- Create: `apps/web/src/lib/use-modal-behavior.ts`
- Test: `apps/web/src/lib/use-modal-behavior.test.tsx`
- Modify: `apps/web/src/components/header.tsx` (mobile menu overlay only)

**Interfaces:**
- Produces: `useModalBehavior(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null>` — while `open`: Escape calls `onClose`, body scroll is locked, focus moves to the ref'd panel, Tab cycles within it, and focus returns to the opener on close/unmount. Consumed by the header menu (here) and the controls sheet (Task 9).

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/use-modal-behavior.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { useModalBehavior } from "./use-modal-behavior";

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => { setOpen(false); onClose?.(); };
  const ref = useModalBehavior(open, close);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      {open && (
        <div role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
          <button>first</button>
          <button>last</button>
        </div>
      )}
    </div>
  );
}

describe("useModalBehavior", () => {
  test("locks body scroll while open and unlocks on close", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
  });

  test("Escape closes and focus returns to the opener", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByText("open");
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  test("Tab wraps from last to first inside the panel", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    const last = screen.getByText("last");
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByText("first")).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- run src/lib/use-modal-behavior.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/use-modal-behavior.ts`:

```ts
"use client";
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog behavior for full-screen overlays (mobile menu, controls sheet):
 * focus moves into the panel on open and back to the opener on close; Escape
 * closes; Tab cycles inside; body scroll is locked while open.
 */
export function useModalBehavior(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // Keep the latest onClose in a ref so the effect depends only on `open` —
  // an inline arrow at the call site must not re-fire the effect (focus steal).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus();
    };
  }, [open]);

  return panelRef;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- run src/lib/use-modal-behavior.test.tsx`
Expected: PASS.

- [ ] **Step 5: Retrofit the header's mobile menu**

In `apps/web/src/components/header.tsx`: add `import { useModalBehavior } from "@/lib/use-modal-behavior";`, inside `Masthead` add `const panelRef = useModalBehavior(open, () => setOpen(false));`, and change the open-menu overlay wrapper from

```tsx
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col items-center gap-8 bg-dark pt-24">
```

to

```tsx
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          ref={panelRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col items-center gap-8 bg-dark pt-24"
        >
```

Run the header tests: `pnpm --filter web test -- run src/components/header.test.tsx`
Expected: PASS (existing tests don't assert overlay attributes; if one snapshots the overlay, update it to expect the dialog role).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/use-modal-behavior.ts apps/web/src/lib/use-modal-behavior.test.tsx apps/web/src/components/header.tsx
git commit -m "feat(web): shared modal behavior hook; mobile nav menu becomes a real dialog"
```

---

### Task 5: Identity row, sign-in panel, avatar disc

**Files:**
- Create: `apps/web/src/components/controls/identity-row.tsx`
- Create: `apps/web/src/components/controls/signin-panel.tsx`
- Test: `apps/web/src/components/controls/identity-row.test.tsx`

**Interfaces:**
- Consumes: `initialOf` (Task 2), `SkewCta` from `@/components/tabloid/skew-cta`.
- Produces: `AvatarDisc({ name, size = 40 })` (decorative, `aria-hidden`); `IdentityRow({ name, provider, tagLine, verified })`; `SignInPanel()` (static). Reused by pill + sheet (Task 9).

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/controls/identity-row.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { IdentityRow } from "./identity-row";
import { SignInPanel } from "./signin-panel";

describe("IdentityRow", () => {
  test("verified: name, provider line, stamp", () => {
    render(<IdentityRow name="BootsColdwater" provider="discord" verified />);
    expect(screen.getByText("BootsColdwater")).toBeInTheDocument();
    expect(screen.getByText("Via discord")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });
  test("unlinked: tag line joins the provider, no stamp", () => {
    render(<IdentityRow name="boots" provider="discord" tagLine="No gamertag" />);
    expect(screen.getByText("Via discord · No gamertag")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
  test("avatar disc is decorative", () => {
    const { container } = render(<IdentityRow name="Boots" provider={null} />);
    const disc = container.querySelector('[aria-hidden="true"]');
    expect(disc?.textContent).toBe("B");
  });
});

describe("SignInPanel", () => {
  test("renders the CTA headline and login link", () => {
    render(<SignInPanel />);
    expect(screen.getByText("Get in the paper.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- run src/components/controls/identity-row.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/components/controls/identity-row.tsx`:

```tsx
import { initialOf } from "./format";

/** Decorative lettered disc standing in for an avatar (we ship no avatar images). */
export function AvatarDisc({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      className="flex flex-none items-center justify-center rounded-full bg-discord font-display font-semibold text-white"
    >
      {initialOf(name)}
    </span>
  );
}

export function IdentityRow({
  name,
  provider,
  tagLine,
  verified = false,
}: {
  name: string;
  provider: string | null;
  tagLine?: string | null;
  verified?: boolean;
}) {
  const sub = [provider ? `Via ${provider}` : null, tagLine ?? null].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3">
      <AvatarDisc name={name} />
      <div className="min-w-0">
        <p className="truncate font-display text-[19px] font-semibold uppercase leading-tight text-ink">{name}</p>
        {sub && <p className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{sub}</p>}
      </div>
      {verified && (
        <span className="ml-auto -rotate-6 border-2 border-red px-2.5 pb-0.5 pt-1 font-display text-xs font-bold uppercase tracking-[.12em] text-red">
          Verified
        </span>
      )}
    </div>
  );
}
```

`apps/web/src/components/controls/signin-panel.tsx`:

```tsx
import { SkewCta } from "@/components/tabloid/skew-cta";

/** Signed-out rail state: the recruitment pitch (canvas 15a voice). */
export function SignInPanel() {
  return (
    <section className="bg-dark p-5">
      <h2 className="font-display text-[26px] font-bold uppercase leading-none text-paper">Get in the paper.</h2>
      <p className="mt-2.5 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-cream-dim">
        Sign in, claim your gamertag, and your deaths make the paper.
      </p>
      <div className="mt-3.5">
        <SkewCta href="/login">Sign in →</SkewCta>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- run src/components/controls/identity-row.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls/identity-row.tsx apps/web/src/components/controls/signin-panel.tsx apps/web/src/components/controls/identity-row.test.tsx
git commit -m "feat(web): controls identity row, avatar disc, signed-out CTA panel"
```

---

### Task 6: Tokens panel

**Files:**
- Create: `apps/web/src/components/controls/tokens-panel.tsx`
- Test: `apps/web/src/components/controls/tokens-panel.test.tsx`

**Interfaces:**
- Produces: `TokensPanel({ balance, send, referrer, onSend, onSetReferrer, showReferrer = true })` where `send`/`referrer` are `{ pending: boolean; error: string | null; ok: boolean }`. Errors arrive pre-mapped (container uses `transferErrorLabel`). `send.ok` clears the send input; `referrer.ok` hides the referrer row. Sheet reuses it with `showReferrer={false}`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/controls/tokens-panel.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TokensPanel } from "./tokens-panel";

const idle = { pending: false, error: null, ok: false };

describe("TokensPanel", () => {
  test("shows the balance and footnote", () => {
    render(<TokensPanel balance={3} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("+1 every 1st of the month · Transfers are final")).toBeInTheDocument();
  });

  test("send submits the trimmed gamertag", () => {
    const onSend = vi.fn();
    render(<TokensPanel balance={2} send={idle} referrer={idle} onSend={onSend} onSetReferrer={() => {}} />);
    fireEvent.change(screen.getByLabelText("Send a token to a verified player"), { target: { value: "  OtherGuy " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("OtherGuy");
  });

  test("send is disabled at zero balance", () => {
    render(<TokensPanel balance={0} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    fireEvent.change(screen.getByLabelText("Send a token to a verified player"), { target: { value: "X" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("shows the mapped send error", () => {
    render(<TokensPanel balance={2} send={{ ...idle, error: "Not a verified player" }} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.getByText("Not a verified player")).toBeInTheDocument();
  });

  test("send.ok clears the input", () => {
    const { rerender } = render(<TokensPanel balance={2} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    const input = screen.getByLabelText("Send a token to a verified player") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "OtherGuy" } });
    rerender(<TokensPanel balance={2} send={{ ...idle, ok: true }} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(input.value).toBe("");
  });

  test("referrer row hides after success and under showReferrer=false", () => {
    const { rerender } = render(<TokensPanel balance={2} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.getByLabelText("Referred by")).toBeInTheDocument();
    rerender(<TokensPanel balance={2} send={idle} referrer={{ ...idle, ok: true }} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.queryByLabelText("Referred by")).not.toBeInTheDocument();
    rerender(<TokensPanel balance={2} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} showReferrer={false} />);
    expect(screen.queryByLabelText("Referred by")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- run src/components/controls/tokens-panel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/components/controls/tokens-panel.tsx`:

```tsx
"use client";
import { useEffect, useState, type FormEvent } from "react";

export type MutationView = { pending: boolean; error: string | null; ok: boolean };

const darkInput =
  "min-w-0 flex-1 border border-dark-line bg-[#111] px-3 py-2 font-mono text-[11.5px] tracking-[.04em] text-paper outline-none placeholder:text-cream-muted focus:border-paper";

export function TokensPanel({
  balance,
  send,
  referrer,
  onSend,
  onSetReferrer,
  showReferrer = true,
}: {
  balance: number;
  send: MutationView;
  referrer: MutationView;
  onSend: (gamertag: string) => void;
  onSetReferrer: (gamertag: string) => void;
  showReferrer?: boolean;
}) {
  const [to, setTo] = useState("");
  const [ref, setRef] = useState("");
  useEffect(() => {
    if (send.ok) setTo("");
  }, [send.ok]);

  const submitSend = (e: FormEvent) => {
    e.preventDefault();
    if (to.trim()) onSend(to.trim());
  };
  const submitRef = (e: FormEvent) => {
    e.preventDefault();
    if (ref.trim()) onSetReferrer(ref.trim());
  };

  return (
    <section className="bg-dark p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[15px] font-bold uppercase tracking-[.1em] text-paper">Unban tokens</h2>
        <span className="font-display text-[26px] font-bold leading-none text-paper">{balance}</span>
      </div>
      <form onSubmit={submitSend} className="mt-3 flex gap-2 border-t border-dark-line pt-3">
        <input
          aria-label="Send a token to a verified player"
          placeholder="SEND TO VERIFIED PLAYER…"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          autoComplete="off"
          className={darkInput}
        />
        <button
          type="submit"
          disabled={balance < 1 || !to.trim() || send.pending}
          className="-skew-x-[5deg] bg-paper px-3.5 py-2 font-display text-[12.5px] font-bold uppercase tracking-[.1em] text-ink disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {send.error && <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{send.error}</p>}
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[.04em] text-cream-muted">
        +1 every 1st of the month · Transfers are final
      </p>
      {showReferrer && !referrer.ok && (
        <>
          <form onSubmit={submitRef} className="mt-3 flex items-center gap-2 border-t border-dark-line pt-3">
            <input
              aria-label="Referred by"
              placeholder="REFERRED BY…"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              autoComplete="off"
              className={darkInput}
            />
            <button
              type="submit"
              disabled={!ref.trim() || referrer.pending}
              className="font-mono text-[10.5px] uppercase tracking-[.05em] text-cream-dim underline underline-offset-2 disabled:opacity-50"
            >
              Set
            </button>
          </form>
          {referrer.error && (
            <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{referrer.error}</p>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- run src/components/controls/tokens-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls/tokens-panel.tsx apps/web/src/components/controls/tokens-panel.test.tsx
git commit -m "feat(web): rail tokens panel — balance, send-by-gamertag, quiet referrer row"
```

---

### Task 7: Server cards (rail variant)

**Files:**
- Create: `apps/web/src/components/controls/server-cards.tsx`
- Test: `apps/web/src/components/controls/server-cards.test.tsx`

**Interfaces:**
- Consumes: `ServerCardData`, `serverFactLine`, `diedAtLabel` (Task 2); `UnbanView`, `unbanStateOf` (Task 3); `banCountdown`, `mapLabel` from `@/components/player/format`.
- Produces: `StateChip({ state })` and `ServerCard({ card, ownSlug, balance, now, onRedeem, redeeming })`. Sheet (Task 9) reuses `StateChip` and the format helpers, not this card.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/controls/server-cards.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ServerCard } from "./server-cards";
import type { ServerCardData } from "./format";
import { diedAtLabel } from "./format";

const NOW = new Date("2026-07-16T12:00:00Z");

const alive: ServerCardData = {
  slug: "chernarus", map: "chernarusplus", state: "alive",
  alive: { timeAliveSeconds: 22920, kills: 0 }, ban: null,
};
const idle: ServerCardData = { slug: "livonia", map: "enoch", state: "idle", alive: null, ban: null };
const banned: ServerCardData = {
  slug: "sakhal", map: "sakhal", state: "banned", alive: null,
  ban: { banId: 9, bannedAt: "2026-07-16T09:47:00Z", expiresAt: "2026-07-17T01:58:00Z", liftPending: false },
};

const base = { ownSlug: "bootscoldwater", balance: 3, now: NOW, onRedeem: () => {}, redeeming: false };

describe("ServerCard", () => {
  test("alive: blue chip and fact line", () => {
    render(<ServerCard card={alive} {...base} />);
    expect(screen.getByText("Alive")).toBeInTheDocument();
    expect(screen.getByText("Qualified · 6h 22m this life · 0 kills")).toBeInTheDocument();
  });

  test("idle: dashed chip and the grace invitation", () => {
    render(<ServerCard card={idle} {...base} />);
    expect(screen.getByText("No life")).toBeInTheDocument();
    expect(screen.getByText("Spawn in any time. First 5 minutes are free.")).toBeInTheDocument();
  });

  test("banned: red chip, died line with obituary link, countdown, spend CTA", () => {
    const onRedeem = vi.fn();
    render(<ServerCard card={banned} {...base} onRedeem={onRedeem} />);
    expect(screen.getByText("Banned")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Died ${diedAtLabel("2026-07-16T09:47:00Z")}`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /obituary/i })).toHaveAttribute("href", "/players/bootscoldwater");
    expect(screen.getByText("Ban lifts in")).toBeInTheDocument();
    expect(screen.getByText("13h 58m")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spend 1 token — skip the wait" }));
    expect(onRedeem).toHaveBeenCalledWith(9);
  });

  test("banned with no tokens: notice instead of CTA", () => {
    render(<ServerCard card={banned} {...base} balance={0} />);
    expect(screen.queryByRole("button", { name: /spend 1 token/i })).not.toBeInTheDocument();
    expect(screen.getByText("No unban tokens")).toBeInTheDocument();
  });

  test("banned with lift pending: mono pending notice", () => {
    const card = { ...banned, ban: { ...banned.ban!, liftPending: true } };
    render(<ServerCard card={card} {...base} />);
    expect(screen.getByText("Unban pending — lifting shortly…")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- run src/components/controls/server-cards.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/components/controls/server-cards.tsx`:

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";
import { banCountdown, mapLabel } from "@/components/player/format";
import { UnbanView, unbanStateOf } from "@/components/player/self-unban-button";
import { serverFactLine, type ServerCardData } from "./format";

export function StateChip({ state, small = false }: { state: ServerCardData["state"]; small?: boolean }) {
  const base = cn("ml-auto flex-none px-2 pb-0.5 pt-1 font-display font-bold uppercase tracking-[.1em]", small ? "text-[9px]" : "text-[10px]");
  if (state === "alive") return <span className={cn(base, "bg-blue text-white")}>Alive</span>;
  if (state === "banned") return <span className={cn(base, "bg-red text-white")}>Banned</span>;
  return <span className={cn(base, "border border-dashed border-dash font-semibold text-ink-muted")}>No life</span>;
}

/** One rail card per active server: name + state chip + fact line; banned adds countdown + spend CTA. */
export function ServerCard({
  card,
  ownSlug,
  balance,
  now,
  onRedeem,
  redeeming,
}: {
  card: ServerCardData;
  ownSlug: string | null;
  balance: number;
  now: Date;
  onRedeem: (banId: number) => void;
  redeeming: boolean;
}) {
  const banned = card.state === "banned" && card.ban !== null;
  const countdown = banned ? banCountdown(card.ban!.expiresAt, now) : null;
  return (
    <section className={cn("border border-hairline bg-white px-4 py-3.5", banned && "border-l-4 border-l-red")}>
      <div className="flex items-center gap-2.5">
        <h3 className="font-display text-base font-semibold uppercase leading-none text-ink">{mapLabel(card.map)}</h3>
        <StateChip state={card.state} />
      </div>
      <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[.04em] text-ink-muted">
        {serverFactLine(card)}
        {banned && ownSlug && (
          <>
            {" · "}
            <Link href={`/players/${ownSlug}`} className="font-bold text-red">
              Obituary →
            </Link>
          </>
        )}
      </p>
      {banned && (
        <>
          {countdown && (
            <div className="mt-2.5 flex items-center justify-between border border-hairline-2 bg-paper px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">Ban lifts in</span>
              <span className="font-display text-lg font-bold text-ink">{countdown}</span>
            </div>
          )}
          <UnbanView
            state={unbanStateOf(card.ban!.liftPending || redeeming, balance)}
            balance={balance}
            onRedeem={() => onRedeem(card.ban!.banId)}
          />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- run src/components/controls/server-cards.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls/server-cards.tsx apps/web/src/components/controls/server-cards.test.tsx
git commit -m "feat(web): rail server cards — alive/no-life/banned with countdown + spend CTA"
```

---

### Task 8: Link-tag panel + prove-it panel (10d)

**Files:**
- Create: `apps/web/src/components/controls/link-panel.tsx`
- Create: `apps/web/src/components/controls/verify-panel.tsx`
- Test: `apps/web/src/components/controls/link-verify-panels.test.tsx`

**Interfaces:**
- Consumes: `searchClaimableGamertags` from `@/lib/api` (mocked in tests); `formatExpiry` from `@/lib/format-expiry`; `SkewCta`; `Challenge` from `@/lib/types`.
- Produces: `LinkTagPanel({ onClaim, pending, error })` (internal 200ms-debounced autocomplete, same pattern the old ClaimForm used); `ProveItPanel({ gamertag, challenge, now, onCancel, onReclaim, canceling, reclaiming })`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/controls/link-verify-panels.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LinkTagPanel } from "./link-panel";
import { ProveItPanel } from "./verify-panel";
import type { Challenge } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  searchClaimableGamertags: vi.fn(async () => ["BOOTSCOLDWATER", "BOOTSNCATS99"]),
}));

const NOW = new Date("2026-07-16T12:00:00Z").getTime();

describe("LinkTagPanel", () => {
  test("renders headline, strapline, and the 1-token footnote", () => {
    render(<LinkTagPanel onClaim={() => {}} pending={false} error={null} />);
    expect(screen.getByText("Link your gamertag.")).toBeInTheDocument();
    expect(screen.getByText("The Xbox gamertag you play under. One per account.")).toBeInTheDocument();
    expect(screen.getByText("We suggest tags seen on our servers. Verifying earns 1 token.")).toBeInTheDocument();
  });

  test("suggests tags and picking one fills the input", async () => {
    render(<LinkTagPanel onClaim={() => {}} pending={false} error={null} />);
    fireEvent.change(screen.getByLabelText("Gamertag"), { target: { value: "Boots" } });
    const suggestion = await screen.findByRole("button", { name: "BOOTSCOLDWATER" });
    fireEvent.click(suggestion);
    expect((screen.getByLabelText("Gamertag") as HTMLInputElement).value).toBe("BOOTSCOLDWATER");
    await waitFor(() => expect(screen.queryByRole("button", { name: "BOOTSNCATS99" })).not.toBeInTheDocument());
  });

  test("submits the claim and shows an error", () => {
    const onClaim = vi.fn();
    const { rerender } = render(<LinkTagPanel onClaim={onClaim} pending={false} error={null} />);
    fireEvent.change(screen.getByLabelText("Gamertag"), { target: { value: "BootsColdwater" } });
    fireEvent.click(screen.getByRole("button", { name: "Claim it" }));
    expect(onClaim).toHaveBeenCalledWith("BootsColdwater");
    rerender(<LinkTagPanel onClaim={onClaim} pending={false} error="That gamertag is already claimed by someone." />);
    expect(screen.getByText("That gamertag is already claimed by someone.")).toBeInTheDocument();
  });
});

const challenge = (over: Partial<Challenge>): Challenge => ({
  sequence: ["facepalm", "salute", "clap"], progressIndex: 1,
  expiresAt: "2026-07-17T10:10:00Z", expired: false, ...over,
});

describe("ProveItPanel", () => {
  test("live challenge: kicker, headline, emote boxes with states, footnote", () => {
    render(<ProveItPanel gamertag="BootsColdwater" challenge={challenge({})} now={NOW} onCancel={() => {}} onReclaim={() => {}} />);
    expect(screen.getByText("Prove it's you")).toBeInTheDocument();
    expect(screen.getByText("BootsColdwater — perform, in order:")).toBeInTheDocument();
    expect(screen.getByText(/expires in 22h/i)).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("✓");
    expect(items[1]!.textContent).toContain("←");
    expect(items[0]).toHaveAttribute("data-done", "true");
    expect(screen.getByText("On any One Life server. Other emotes between are fine — order is what counts. Only whoever controls the tag can finish this.")).toBeInTheDocument();
  });

  test("cancel fires", () => {
    const onCancel = vi.fn();
    render(<ProveItPanel gamertag="Boots" challenge={challenge({})} now={NOW} onCancel={onCancel} onReclaim={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel claim" }));
    expect(onCancel).toHaveBeenCalled();
  });

  test("expired: reclaim CTA replaces the boxes", () => {
    const onReclaim = vi.fn();
    render(<ProveItPanel gamertag="Boots" challenge={challenge({ expired: true })} now={NOW} onCancel={() => {}} onReclaim={onReclaim} />);
    expect(screen.getByText("Your verification for Boots expired")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a new challenge →" }));
    expect(onReclaim).toHaveBeenCalled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- run src/components/controls/link-verify-panels.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the link panel**

`apps/web/src/components/controls/link-panel.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { searchClaimableGamertags } from "@/lib/api";

/** Unlinked rail state (canvas 10d): dark claim panel with claimable-tag autocomplete. */
export function LinkTagPanel({
  onClaim,
  pending,
  error,
}: {
  onClaim: (gamertag: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [tag, setTag] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Race guards: drop out-of-order responses; don't re-search right after a pick.
  const searchSeq = useRef(0);
  const skipSearch = useRef(false);

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const q = tag.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      const seq = ++searchSeq.current;
      searchClaimableGamertags(q)
        .then((results) => {
          if (seq === searchSeq.current) setSuggestions(results);
        })
        .catch(() => {
          if (seq === searchSeq.current) setSuggestions([]);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [tag]);

  return (
    <section className="bg-dark p-5">
      <h2 className="font-display text-[26px] font-bold uppercase leading-none text-paper">Link your gamertag.</h2>
      <p className="mt-2.5 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-cream-dim">
        The Xbox gamertag you play under. One per account.
      </p>
      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (tag.trim()) onClaim(tag.trim());
        }}
      >
        <label htmlFor="rail-gamertag" className="sr-only">
          Gamertag
        </label>
        <input
          id="rail-gamertag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          autoComplete="off"
          placeholder="GAMERTAG…"
          className="w-full border border-paper bg-[#111] px-3 py-2.5 font-mono text-[13px] tracking-[.04em] text-paper outline-none placeholder:text-cream-muted"
        />
        {suggestions.length > 0 && (
          <ul className="border border-t-0 border-dark-line bg-[#111]">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => {
                    skipSearch.current = true;
                    searchSeq.current++; // invalidate any in-flight search
                    setTag(s);
                    setSuggestions([]);
                  }}
                  className="w-full px-3 py-2 text-left font-mono text-xs uppercase text-cream-dim hover:bg-[#1A1A12] hover:text-paper"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="submit"
          disabled={pending || !tag.trim()}
          className="mt-3 -skew-x-[5deg] bg-paper px-4 py-2 font-display text-[13px] font-bold uppercase tracking-[.08em] text-ink disabled:opacity-50"
        >
          {pending ? "Claiming…" : "Claim it"}
        </button>
      </form>
      {error && <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">{error}</p>}
      <p className="mt-2.5 font-mono text-[10px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
        We suggest tags seen on our servers. Verifying earns 1 token.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Implement the prove-it panel**

`apps/web/src/components/controls/verify-panel.tsx`:

```tsx
import type { Challenge } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatExpiry } from "@/lib/format-expiry";
import { SkewCta } from "@/components/tabloid/skew-cta";

const quietBtn =
  "font-mono text-[10.5px] uppercase tracking-[.05em] text-cream-muted underline underline-offset-2 hover:text-paper disabled:opacity-50";

/** Pending rail state (canvas 10d): yellow-bordered dark panel with the emote sequence. */
export function ProveItPanel({
  gamertag,
  challenge,
  now,
  onCancel,
  onReclaim,
  canceling,
  reclaiming,
}: {
  gamertag: string;
  challenge: Challenge | null;
  now: number;
  onCancel: () => void;
  onReclaim: () => void;
  canceling?: boolean;
  reclaiming?: boolean;
}) {
  const expired = !challenge || challenge.expired;
  if (expired) {
    return (
      <section className="border-2 border-yellow bg-dark p-5">
        <p className="font-display text-xs font-bold uppercase tracking-[.16em] text-yellow">Prove it's you</p>
        <p className="mt-2 font-display text-2xl font-bold uppercase leading-none text-paper">
          Your verification for {gamertag} expired
        </p>
        <p className="mt-2 font-mono text-[10.5px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
          The emote challenge timed out. Start a fresh one and perform the new sequence in game.
        </p>
        <div className="mt-3.5 flex flex-wrap items-center gap-4">
          <SkewCta onClick={onReclaim} disabled={reclaiming}>Start a new challenge →</SkewCta>
          <button type="button" onClick={onCancel} disabled={canceling} className={quietBtn}>
            Cancel claim
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="border-2 border-yellow bg-dark p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-xs font-bold uppercase tracking-[.16em] text-yellow">Prove it's you</p>
        <span className="font-mono text-[11px] font-bold uppercase text-yellow">{formatExpiry(challenge.expiresAt, now)}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold uppercase leading-none text-paper">{gamertag} — perform, in order:</p>
      <ol className="mt-3.5 flex gap-2 font-mono text-[12px] tracking-[.03em]">
        {challenge.sequence.map((emote, i) => {
          const done = i < challenge.progressIndex;
          const current = i === challenge.progressIndex;
          return (
            <li
              key={i}
              data-done={String(done)}
              className={cn(
                "flex-1 px-2 py-3 text-center uppercase",
                done && "bg-paper font-bold text-ink",
                current && "border border-dashed border-[#6A6852] bg-[#1A1A12] text-yellow",
                !done && !current && "border border-dashed border-dark-line text-cream-muted",
              )}
            >
              {i + 1} {emote}
              {done ? " ✓" : current ? " ←" : ""}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
        On any One Life server. Other emotes between are fine — order is what counts. Only whoever controls the tag can finish this.
      </p>
      <div className="mt-3">
        <button type="button" onClick={onCancel} disabled={canceling} className={quietBtn}>
          Cancel claim
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter web test -- run src/components/controls/link-verify-panels.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/controls/link-panel.tsx apps/web/src/components/controls/verify-panel.tsx apps/web/src/components/controls/link-verify-panels.test.tsx
git commit -m "feat(web): in-rail link-tag and prove-it panels (canvas 10d)"
```

---

### Task 9: `useControls` data hook + `ControlsRail` container

**Files:**
- Create: `apps/web/src/components/controls/use-controls.ts`
- Create: `apps/web/src/components/controls/rail.tsx`
- Test: `apps/web/src/components/controls/rail.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2, 5–8; `useAccountStatus`, `useClaimGamertag`, `useCancelLink`, `getMe/getTokens/getServers/getPlayerPage/transferToken/setReferrer/redeemToken`, `playerSlug`, `claimErrorMessage`, `signOut`, `ApiError`.
- Produces:
  - `useControls(): Controls` where `Controls = { status: AccountStatus; name: string | null; provider: string | null; balance: number | null; servers: Server[]; standing: ServerStanding[] }`
  - `useControlsActions()` returning `{ claim, cancel, send, refer, redeem }` TanStack mutations
  - `ControlsRail()` — the desktop rail (`hidden xl:block`), consumed by the root layout (Task 11). Task 10's `MobileControls` reuses both hooks.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/controls/rail.test.tsx` (containers are normally untested; the rail's state switch is the one piece of container logic worth a gate, so mock both hooks):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { ControlsRail } from "./rail";
import { useControls, useControlsActions } from "./use-controls";

vi.mock("./use-controls", () => ({ useControls: vi.fn(), useControlsActions: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ signOut: vi.fn(async () => {}) }));

const mut = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null });
const base = { name: "Boots", provider: "discord", balance: 3, servers: [], standing: [] };

beforeEach(() => {
  (useControlsActions as Mock).mockReturnValue({ claim: mut(), cancel: mut(), send: mut(), refer: mut(), redeem: mut() });
});

describe("ControlsRail", () => {
  test("signed out: CTA panel only", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "signedOut" } });
    render(<ControlsRail />);
    expect(screen.getByText("Get in the paper.")).toBeInTheDocument();
    expect(screen.queryByText("Unban tokens")).not.toBeInTheDocument();
  });

  test("unlinked: identity + link panel", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "unlinked" } });
    render(<ControlsRail />);
    expect(screen.getByText("Via discord · No gamertag")).toBeInTheDocument();
    expect(screen.getByText("Link your gamertag.")).toBeInTheDocument();
  });

  test("pending: prove-it panel", () => {
    (useControls as Mock).mockReturnValue({
      ...base,
      status: { kind: "pending", link: { id: 1, gamertag: "Boots", status: "pending", verifiedAt: null, challenge: { sequence: ["facepalm", "salute", "clap"], progressIndex: 0, expiresAt: "2027-01-01T00:00:00Z", expired: false } } },
    });
    render(<ControlsRail />);
    expect(screen.getByText("Prove it's you")).toBeInTheDocument();
  });

  test("verified: identity + tokens + servers header + footer links", () => {
    (useControls as Mock).mockReturnValue({
      ...base,
      status: { kind: "verified", link: { id: 1, gamertag: "BootsColdwater", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null } },
      servers: [{ id: 1, nitradoServiceId: 1, name: "s", map: "chernarusplus", slug: "chernarus", active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z" }],
    });
    render(<ControlsRail />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Unban tokens")).toBeInTheDocument();
    expect(screen.getByText("Your servers")).toBeInTheDocument();
    expect(screen.getByText("No life")).toBeInTheDocument(); // never-played server renders idle
    expect(screen.getByRole("link", { name: "Your profile →" })).toHaveAttribute("href", "/players/bootscoldwater");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  test("loading: skeleton, nothing interactive", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "loading" } });
    const { container } = render(<ControlsRail />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- run src/components/controls/rail.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the hooks**

`apps/web/src/components/controls/use-controls.ts`:

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountStatus } from "@/lib/use-account-status";
import { useCancelLink, useClaimGamertag } from "@/lib/use-gamertag-links";
import { getMe, getPlayerPage, getServers, getTokens, redeemToken, setReferrer, transferToken } from "@/lib/api";
import { playerSlug } from "@/lib/slug";
import type { AccountStatus } from "@/lib/account-status";
import type { Server, ServerStanding } from "@/lib/types";

export type Controls = {
  status: AccountStatus;
  name: string | null;
  provider: string | null;
  balance: number | null;
  servers: Server[];
  standing: ServerStanding[];
};

/** One data source for all three control surfaces (rail, pill, sheet). */
export function useControls(): Controls {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const me = useQuery({ queryKey: ["me"], queryFn: getMe, enabled: signedIn, staleTime: 60_000 });
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: getTokens, enabled: signedIn });
  const servers = useQuery({ queryKey: ["servers"], queryFn: getServers, enabled: signedIn, staleTime: 5 * 60_000 });
  const gamertag = status.kind === "verified" ? status.link.gamertag : null;
  const player = useQuery({
    queryKey: ["player-page", gamertag],
    queryFn: () => getPlayerPage(playerSlug(gamertag!)),
    enabled: gamertag !== null,
    refetchInterval: 60_000, // ban countdowns tick once a minute
  });
  return {
    status,
    name: me.data?.user.name || me.data?.user.email?.split("@")[0] || null,
    provider: me.data?.accounts[0]?.providerId ?? null,
    balance: tokens.data?.balance ?? null,
    servers: servers.data ?? [],
    standing: player.data?.standing ?? [],
  };
}

/** The mutations behind the rail/sheet controls, shared so both surfaces stay in sync. */
export function useControlsActions() {
  const qc = useQueryClient();
  const claim = useClaimGamertag();
  const cancel = useCancelLink();
  const send = useMutation({
    mutationFn: (gt: string) => transferToken(gt),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tokens"] }),
  });
  const refer = useMutation({ mutationFn: (gt: string) => setReferrer(gt) });
  const redeem = useMutation({
    mutationFn: (banId: number) => redeemToken(banId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tokens"] });
      void qc.invalidateQueries({ queryKey: ["player-page"] });
    },
  });
  return { claim, cancel, send, refer, redeem };
}
```

- [ ] **Step 4: Implement the rail**

`apps/web/src/components/controls/rail.tsx`:

```tsx
"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth-client";
import { claimErrorMessage } from "@/lib/claim-error";
import { playerSlug } from "@/lib/slug";
import { ApiError } from "@/lib/api";
import { useControls, useControlsActions } from "./use-controls";
import { serverCards, transferErrorLabel } from "./format";
import { IdentityRow } from "./identity-row";
import { SignInPanel } from "./signin-panel";
import { LinkTagPanel } from "./link-panel";
import { ProveItPanel } from "./verify-panel";
import { TokensPanel, type MutationView } from "./tokens-panel";
import { ServerCard } from "./server-cards";

function RailSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div aria-hidden className="h-10 animate-pulse bg-tint" />
      <div aria-hidden className="h-40 animate-pulse bg-tint" />
      <div aria-hidden className="h-24 animate-pulse bg-tint" />
    </div>
  );
}

function mutView(m: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown }): MutationView {
  return {
    pending: m.isPending,
    ok: m.isSuccess,
    error: m.isError ? transferErrorLabel(m.error instanceof ApiError ? m.error.code : "") : null,
  };
}

/** Desktop controls rail (canvas 10a/10d) — the right column of the root layout at xl+. */
export function ControlsRail() {
  const c = useControls();
  const a = useControlsActions();
  const now = new Date();
  const cards = serverCards(c.servers, c.standing);

  let body: ReactNode;
  if (c.status.kind === "loading") {
    body = <RailSkeleton />;
  } else if (c.status.kind === "signedOut") {
    body = <SignInPanel />;
  } else if (c.status.kind === "unlinked") {
    body = (
      <>
        <IdentityRow name={c.name ?? "You"} provider={c.provider} tagLine="No gamertag" />
        <LinkTagPanel
          pending={a.claim.isPending}
          error={a.claim.isError ? claimErrorMessage(a.claim.error) : null}
          onClaim={(gt) => a.claim.mutate({ gamertag: gt })}
        />
      </>
    );
  } else if (c.status.kind === "pending") {
    const link = c.status.link;
    body = (
      <>
        <IdentityRow name={link.gamertag} provider={c.provider} />
        <ProveItPanel
          gamertag={link.gamertag}
          challenge={link.challenge}
          now={now.getTime()}
          onCancel={() => a.cancel.mutate(link.id)}
          onReclaim={() => a.claim.mutate({ gamertag: link.gamertag })}
          canceling={a.cancel.isPending}
          reclaiming={a.claim.isPending}
        />
      </>
    );
  } else {
    const gamertag = c.status.link.gamertag;
    const slug = playerSlug(gamertag);
    body = (
      <>
        <IdentityRow name={gamertag} provider={c.provider} verified />
        <TokensPanel
          balance={c.balance ?? 0}
          send={mutView(a.send)}
          referrer={mutView(a.refer)}
          onSend={(gt) => a.send.mutate(gt)}
          onSetReferrer={(gt) => a.refer.mutate(gt)}
        />
        <h2 className="border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-bold uppercase tracking-[.14em] text-ink">
          Your servers
        </h2>
        {cards.map((card) => (
          <ServerCard
            key={card.slug}
            card={card}
            ownSlug={slug}
            balance={c.balance ?? 0}
            now={now}
            onRedeem={(banId) => a.redeem.mutate(banId)}
            redeeming={a.redeem.isPending}
          />
        ))}
        <div className="flex justify-between border-t border-hairline pt-2.5 font-mono text-[11px] uppercase tracking-[.05em]">
          <Link href={`/players/${slug}`} className="font-bold text-ink hover:text-red">
            Your profile →
          </Link>
          <button
            type="button"
            onClick={() => void signOut().finally(() => { window.location.href = "/"; })}
            className="text-ink-muted hover:text-red"
          >
            Sign out
          </button>
        </div>
      </>
    );
  }

  return (
    <aside aria-label="Player controls" className="hidden py-8 pl-7 xl:sticky xl:top-0 xl:block xl:max-h-screen xl:self-start xl:overflow-y-auto">
      <div className="flex flex-col gap-4">{body}</div>
    </aside>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter web test -- run src/components/controls/rail.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/controls/use-controls.ts apps/web/src/components/controls/rail.tsx apps/web/src/components/controls/rail.test.tsx
git commit -m "feat(web): useControls data layer + desktop controls rail"
```

---

### Task 10: Mobile pill + bottom sheet

**Files:**
- Create: `apps/web/src/components/controls/pill.tsx`
- Create: `apps/web/src/components/controls/sheet.tsx`
- Create: `apps/web/src/components/controls/mobile-controls.tsx`
- Modify: `apps/web/src/components/controls/tokens-panel.tsx` (add `boxed` prop)
- Test: `apps/web/src/components/controls/pill.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 4–9 (`pillStatus`, `serverCards`, `AvatarDisc`, `StateChip`, `TokensPanel`, `LinkTagPanel`, `ProveItPanel`, `useControls`, `useControlsActions`, `useModalBehavior`, `UnbanState`, `unbanStateOf`, `SkewCta`).
- Produces: `ControlsPillView(props)` (presentational), `ControlsSheet({ open, onClose, header, children })` (dialog wrapper), `MobileControls()` (container; renders nothing signed out) — consumed by the root layout in Task 11.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/controls/pill.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ControlsPillView } from "./pill";

const line = { text: "Sakhal ban lifts in 13h 58m", tone: "red" as const };

describe("ControlsPillView", () => {
  test("verified pill: label, status line, dots, token count, opens on click", () => {
    const onOpen = vi.fn();
    render(
      <ControlsPillView name="Boots" line={line} dots={["alive", "idle", "banned"]} balance={3} verified open={false} onOpen={onOpen} />,
    );
    const pill = screen.getByRole("button");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Player controls")).toBeInTheDocument();
    expect(screen.getByText("Sakhal ban lifts in 13h 58m")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.click(pill);
    expect(onOpen).toHaveBeenCalled();
  });

  test("unverified pill: no dots, no token count", () => {
    render(
      <ControlsPillView name="Boots" line={{ text: "Link your gamertag →", tone: "dim" }} dots={[]} balance={null} verified={false} open={false} onOpen={() => {}} />,
    );
    expect(screen.getByText("Link your gamertag →")).toBeInTheDocument();
    expect(screen.queryByText("tok")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- run src/components/controls/pill.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pill view**

`apps/web/src/components/controls/pill.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { AvatarDisc } from "./identity-row";
import type { PillLine, ServerCardData } from "./format";

const TONE: Record<PillLine["tone"], string> = {
  red: "text-red-soft",
  yellow: "text-yellow",
  dim: "text-cream-dim",
  muted: "text-cream-muted",
};

/** Floating mobile pill (canvas 10b). One big button; the sheet is its dialog. */
export function ControlsPillView({
  name,
  line,
  dots,
  balance,
  verified,
  open,
  onOpen,
}: {
  name: string;
  line: PillLine;
  dots: ServerCardData["state"][];
  balance: number | null;
  verified: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      aria-haspopup="dialog"
      className="fixed inset-x-3.5 bottom-3.5 z-40 flex min-h-[44px] items-center gap-3 border-2 border-red bg-dark px-4 py-2.5 text-left shadow-[0_10px_30px_rgba(0,0,0,.35)] xl:hidden"
    >
      <AvatarDisc name={name} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-sm font-bold uppercase tracking-[.08em] leading-tight text-paper">
          Player controls
        </span>
        <span className={cn("block truncate font-mono text-[10px] uppercase tracking-[.04em]", TONE[line.tone])}>
          {line.text}
        </span>
      </span>
      {verified && (
        <>
          <span aria-hidden className="flex flex-none items-center gap-1.5">
            {dots.map((s, i) => (
              <span
                key={i}
                className={cn(
                  "h-[9px] w-[9px] rounded-full",
                  s === "alive" && "bg-blue",
                  s === "banned" && "bg-red",
                  s === "idle" && "border border-dashed border-cream-muted",
                )}
              />
            ))}
          </span>
          <span className="flex-none border-l border-dark-line pl-3 font-display text-[15px] font-bold leading-none text-paper">
            {balance ?? 0} <span className="text-[10px] tracking-[.06em] text-cream-muted">tok</span>
          </span>
        </>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Implement the sheet wrapper + dark server rows**

First, in `apps/web/src/components/controls/tokens-panel.tsx`, make the outer box swappable — change the component signature/opening tag:

```tsx
export function TokensPanel({
  balance, send, referrer, onSend, onSetReferrer, showReferrer = true, boxed = false,
}: {
  balance: number; send: MutationView; referrer: MutationView;
  onSend: (gamertag: string) => void; onSetReferrer: (gamertag: string) => void;
  showReferrer?: boolean; boxed?: boolean;
}) {
```

and the `<section>` opener becomes:

```tsx
    <section className={boxed ? "border border-dark-line p-4" : "bg-dark p-5"}>
```

(add `import { cn } from "@/lib/utils";` only if you use it — the ternary above doesn't need it).

`apps/web/src/components/controls/sheet.tsx`:

```tsx
"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { banCountdown, mapLabel } from "@/components/player/format";
import { unbanStateOf, type UnbanState } from "@/components/player/self-unban-button";
import { SkewCta } from "@/components/tabloid/skew-cta";
import { serverFactLine, type ServerCardData } from "./format";
import { StateChip } from "./server-cards";

/** Bottom sheet chrome (canvas 10c): overlay + dark panel with drag handle and close. */
export function ControlsSheet({
  open,
  onClose,
  header,
  children,
}: {
  open: boolean;
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useModalBehavior(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <div aria-hidden className="absolute inset-0 bg-dark/55" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Player controls"
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto border-t-[3px] border-red bg-dark shadow-[0_-18px_40px_rgba(0,0,0,.45)]"
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-11 rounded-sm bg-[#4A4838]" />
        <div className="flex items-center gap-3 border-b border-dark-line px-[18px] py-3">
          <div className="min-w-0 flex-1">{header}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close controls"
            className="flex h-11 w-11 flex-none items-center justify-center text-2xl leading-none text-cream-muted hover:text-paper"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
        <div className="flex flex-col gap-3 px-[18px] pb-5 pt-3.5">{children}</div>
      </div>
    </div>
  );
}

function SheetUnban({ state, onRedeem }: { state: UnbanState; onRedeem: () => void }) {
  if (state === "hidden") return null;
  if (state === "pending") {
    return <p className="mt-2 font-mono text-[10px] uppercase tracking-[.05em] text-cream-dim">Unban pending — lifting shortly…</p>;
  }
  if (state === "no-tokens") {
    return (
      <p className="mt-2 border border-dashed border-[#4A4838] px-2.5 py-1.5 text-center font-mono text-[10px] uppercase tracking-[.05em] text-red-soft">
        No unban tokens
      </p>
    );
  }
  return (
    <div className="mt-2">
      <SkewCta onClick={onRedeem}>Spend 1 token — skip the wait</SkewCta>
    </div>
  );
}

/** Dark-compact server row for the sheet (canvas 10c). */
export function SheetServerRow({
  card,
  ownSlug,
  balance,
  now,
  onRedeem,
  redeeming,
}: {
  card: ServerCardData;
  ownSlug: string | null;
  balance: number;
  now: Date;
  onRedeem: (banId: number) => void;
  redeeming: boolean;
}) {
  const banned = card.state === "banned" && card.ban !== null;
  const countdown = banned ? banCountdown(card.ban!.expiresAt, now) : null;
  return (
    <section className={cn("border border-dark-line px-3.5 py-3", banned && "border-l-[3px] border-l-red")}>
      <div className="flex items-center gap-2.5">
        <h3 className="flex-none font-display text-sm font-semibold uppercase leading-none text-paper">{mapLabel(card.map)}</h3>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[.03em] text-cream-muted">
          {serverFactLine(card)}
          {banned && ownSlug && (
            <>
              {" · "}
              <Link href={`/players/${ownSlug}`} className="text-red-soft">Obit →</Link>
            </>
          )}
        </span>
        <StateChip state={card.state} small />
      </div>
      {banned && (
        <>
          {countdown && (
            <div className="mt-2 flex items-center justify-between border border-dark-line bg-[#111] px-2.5 py-1.5">
              <span className="font-mono text-[9.5px] uppercase tracking-[.06em] text-cream-muted">Ban lifts in</span>
              <span className="font-display text-base font-bold text-paper">{countdown}</span>
            </div>
          )}
          <SheetUnban state={unbanStateOf(card.ban!.liftPending || redeeming, balance)} onRedeem={() => onRedeem(card.ban!.banId)} />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Implement the container**

`apps/web/src/components/controls/mobile-controls.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { signOut } from "@/lib/auth-client";
import { claimErrorMessage } from "@/lib/claim-error";
import { playerSlug } from "@/lib/slug";
import { useControls, useControlsActions } from "./use-controls";
import { pillStatus, serverCards, transferErrorLabel } from "./format";
import { AvatarDisc } from "./identity-row";
import { ControlsPillView } from "./pill";
import { ControlsSheet, SheetServerRow } from "./sheet";
import { TokensPanel, type MutationView } from "./tokens-panel";
import { LinkTagPanel } from "./link-panel";
import { ProveItPanel } from "./verify-panel";
import { ApiError } from "@/lib/api";

function mutView(m: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown }): MutationView {
  return {
    pending: m.isPending,
    ok: m.isSuccess,
    error: m.isError ? transferErrorLabel(m.error instanceof ApiError ? m.error.code : "") : null,
  };
}

/** Mobile pill + bottom sheet (canvas 10b/10c). Renders nothing for signed-out visitors. */
export function MobileControls() {
  const c = useControls();
  const a = useControlsActions();
  const [open, setOpen] = useState(false);
  const signedIn = c.status.kind === "unlinked" || c.status.kind === "pending" || c.status.kind === "verified";
  if (!signedIn) return null;

  const now = new Date();
  const cards = serverCards(c.servers, c.standing);
  const verified = c.status.kind === "verified";
  const gamertag =
    c.status.kind === "verified" || c.status.kind === "pending" ? c.status.link.gamertag : null;
  const name = gamertag ?? c.name ?? "You";
  const slug = verified && gamertag ? playerSlug(gamertag) : null;
  const line = pillStatus(c.status, cards, now);

  const header = (
    <div className="flex items-center gap-3">
      <AvatarDisc name={name} size={34} />
      <div className="min-w-0">
        <p className="truncate font-display text-base font-semibold uppercase leading-tight text-paper">{name}</p>
        <p className="font-mono text-[10px] uppercase tracking-[.05em] text-cream-muted">
          {c.provider ? `Via ${c.provider}` : ""}
          {verified && (
            <>
              {c.provider ? " · " : ""}
              <span className="font-bold text-red-soft">Verified</span>
            </>
          )}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <ControlsPillView
        name={name}
        line={line}
        dots={cards.map((x) => x.state)}
        balance={c.balance}
        verified={verified}
        open={open}
        onOpen={() => setOpen(true)}
      />
      <ControlsSheet open={open} onClose={() => setOpen(false)} header={header}>
        {c.status.kind === "unlinked" && (
          <LinkTagPanel
            pending={a.claim.isPending}
            error={a.claim.isError ? claimErrorMessage(a.claim.error) : null}
            onClaim={(gt) => a.claim.mutate({ gamertag: gt })}
          />
        )}
        {c.status.kind === "pending" && (
          <ProveItPanel
            gamertag={c.status.link.gamertag}
            challenge={c.status.link.challenge}
            now={now.getTime()}
            onCancel={() => a.cancel.mutate((c.status as { link: { id: number } }).link.id)}
            onReclaim={() => a.claim.mutate({ gamertag: (c.status as { link: { gamertag: string } }).link.gamertag })}
            canceling={a.cancel.isPending}
            reclaiming={a.claim.isPending}
          />
        )}
        {verified && (
          <>
            <TokensPanel
              boxed
              showReferrer={false}
              balance={c.balance ?? 0}
              send={mutView(a.send)}
              referrer={mutView(a.refer)}
              onSend={(gt) => a.send.mutate(gt)}
              onSetReferrer={() => {}}
            />
            {cards.map((card) => (
              <SheetServerRow
                key={card.slug}
                card={card}
                ownSlug={slug}
                balance={c.balance ?? 0}
                now={now}
                onRedeem={(banId) => a.redeem.mutate(banId)}
                redeeming={a.redeem.isPending}
              />
            ))}
            <div className="flex justify-between font-mono text-[10px] uppercase tracking-[.06em]">
              {slug && (
                <Link href={`/players/${slug}`} className="text-cream-dim hover:text-paper">
                  Your profile →
                </Link>
              )}
              <button
                type="button"
                onClick={() => void signOut().finally(() => { window.location.href = "/"; })}
                className="text-cream-muted hover:text-paper"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </ControlsSheet>
    </>
  );
}
```

(If TypeScript narrows `c.status` cleanly inside the JSX blocks, drop the two `as` casts — they're only there because narrowing can be lost inside closures; prefer extracting `const link = c.status.link` above the JSX when the compiler allows.)

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter web test -- run src/components/controls/pill.test.tsx src/components/controls/tokens-panel.test.tsx`
Expected: PASS (pill tests green; tokens-panel tests still green with the new optional prop).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/controls/pill.tsx apps/web/src/components/controls/sheet.tsx apps/web/src/components/controls/mobile-controls.tsx apps/web/src/components/controls/tokens-panel.tsx apps/web/src/components/controls/pill.test.tsx
git commit -m "feat(web): mobile controls pill + bottom sheet"
```

---

### Task 11: Layout integration + retirements

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/components/header.tsx` + `apps/web/src/components/header.test.tsx`
- Modify: `apps/web/src/app/welcome/page.tsx`
- Modify: `apps/web/src/lib/types.ts` (serverId fix redo)
- Modify: `apps/web/src/lib/account-status.test.ts`, `apps/web/src/lib/active-link.test.ts` (fixtures lose `serverId`)
- Delete: `apps/web/src/app/account/` (whole directory), `apps/web/src/components/status-banner.tsx`, `status-banner.test.tsx`, `status-banner-container.tsx`, `masthead-slot.tsx`, `links-list.tsx`, `links-list.test.tsx`, `token-wallet.tsx`, `token-wallet.test.tsx`, `claim-form.tsx`, `claim-form.test.tsx`, `claim-status.tsx`, `claim-status.test.tsx`, `emote-sequence.tsx`, `emote-sequence.test.tsx`

**Interfaces:**
- Consumes: `ControlsRail` (Task 9), `MobileControls` (Task 10).
- Produces: the site-wide grid; `/account` + `/account/claim` now 404; `GamertagLink`/`ClaimResult` without `serverId`.

- [ ] **Step 1: Rewrite the layout body**

In `apps/web/src/app/layout.tsx`: drop the `StatusBannerContainer` import, add `import { ControlsRail } from "@/components/controls/rail";` and `import { MobileControls } from "@/components/controls/mobile-controls";`, and replace the `<QueryProvider>` body with:

```tsx
        <QueryProvider>
          <Masthead />
          <div
            id="content"
            className="mx-auto w-full max-w-[1440px] flex-1 xl:grid xl:grid-cols-[minmax(0,1fr)_380px] xl:px-10"
          >
            <div className="min-w-0 pb-24 xl:border-r xl:border-ink xl:pb-0 xl:pr-8">{children}</div>
            <ControlsRail />
          </div>
          <MobileControls />
          <Footer />
        </QueryProvider>
```

(The skip link keeps pointing at `#content`. `pb-24 xl:pb-0` is the static pill clearance the spec accepts.)

- [ ] **Step 2: Strip the masthead slot**

In `apps/web/src/components/header.tsx`: remove the `MastheadSlot` import, the `useAccountStatus` import, the `const status = useAccountStatus();` line, and the `<div className="absolute right-4">…</div>` block. In `apps/web/src/components/header.test.tsx`: remove any mock of `@/lib/use-account-status` and any assertions about the slot (gamertag chip / Account link); keep the nav + hamburger tests. Delete `apps/web/src/components/masthead-slot.tsx` (there is no separate masthead-slot test file; its cases live in header.test.tsx — delete them there).

- [ ] **Step 3: Retarget /welcome**

In `apps/web/src/app/welcome/page.tsx`, replace the last three lines of the resolver:

```tsx
  if (link?.status === "verified") redirect(`/players/${playerSlug(link.gamertag)}`);
  redirect("/");
```

(pending and unlinked both land on `/` — the rail/pill carries the next action). Update the doc comment above the function to match.

- [ ] **Step 4: Delete the retired surfaces**

```bash
git rm -r apps/web/src/app/account
git rm apps/web/src/components/status-banner.tsx apps/web/src/components/status-banner.test.tsx \
       apps/web/src/components/status-banner-container.tsx apps/web/src/components/masthead-slot.tsx \
       apps/web/src/components/links-list.tsx apps/web/src/components/links-list.test.tsx \
       apps/web/src/components/token-wallet.tsx apps/web/src/components/token-wallet.test.tsx \
       apps/web/src/components/claim-form.tsx apps/web/src/components/claim-form.test.tsx \
       apps/web/src/components/claim-status.tsx apps/web/src/components/claim-status.test.tsx \
       apps/web/src/components/emote-sequence.tsx apps/web/src/components/emote-sequence.test.tsx
```

If a listed test file doesn't exist, skip it. Then `grep -rn "status-banner\|masthead-slot\|links-list\|token-wallet\|claim-form\|claim-status\|emote-sequence\|/account" apps/web/src --include='*.ts*'` and fix any straggler import (expected: only `/account` hits inside comments or none).

- [ ] **Step 5: serverId fix redo**

In `apps/web/src/lib/types.ts`, delete the `serverId: number;` line from **both** `GamertagLink` and `ClaimResult`. Remove `serverId` from any fixtures in `apps/web/src/lib/account-status.test.ts` and `apps/web/src/lib/active-link.test.ts` (and any other web test that builds a `GamertagLink` — grep `serverId` under `apps/web/src`).

- [ ] **Step 6: Run the whole web suite + typecheck**

Run: `pnpm --filter web test -- run` and `pnpm --filter web typecheck` (or `pnpm turbo run typecheck --filter=web`)
Expected: PASS — no dangling imports, no `serverId` type errors.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): site-wide controls rail layout; retire /account, banner, masthead slot"
```

---

### Task 12: Login restyle + error/404 sweep + UI-primitive deletion

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`, `apps/web/src/components/login-form.tsx`, `apps/web/src/components/login-form.test.tsx`
- Modify: `apps/web/src/app/error.tsx`, `apps/web/src/app/not-found.tsx`
- Delete: `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/ui/input.tsx`, `apps/web/src/components/ui/table.tsx` (the `ui/` directory)

**Interfaces:**
- Consumes: `SkewCta`. `login-panel.tsx` is untouched (wiring only).
- Produces: tabloid login; error/404 on new tokens; zero `ui/*` imports left in the app.

- [ ] **Step 1: Rewrite the login form + its tests**

`apps/web/src/components/login-form.tsx` (full replacement):

```tsx
"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

const PROVIDERS = ["discord", "google", "github"] as const;

export function LoginForm({
  providers,
  magicLink,
  onMagicLink,
  onSocial,
}: {
  providers: string[];
  magicLink: boolean;
  onMagicLink: (email: string) => Promise<void>;
  onSocial: (provider: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onMagicLink(email);
      setSent(true);
    } catch {
      setError("Could not send the link. Try again.");
    }
  }

  const socials = PROVIDERS.filter((p) => providers.includes(p));
  const nothingConfigured = !magicLink && socials.length === 0;

  return (
    <div className="bg-dark p-6">
      {nothingConfigured && (
        <p className="font-mono text-xs uppercase tracking-[.04em] text-cream-muted">
          No sign-in methods are currently available.
        </p>
      )}
      {socials.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {socials.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onSocial(p)}
              className={cn(
                "-skew-x-[5deg] px-5 py-3 text-center font-display text-sm font-bold uppercase tracking-[.08em]",
                p === "discord" ? "bg-discord text-white hover:opacity-90" : "border border-paper text-paper hover:bg-paper hover:text-ink",
              )}
            >
              Continue with {p}
            </button>
          ))}
        </div>
      )}
      {magicLink && socials.length > 0 && (
        <div className="my-5 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-dark-line" />
          <span className="font-mono text-[10px] uppercase text-cream-muted">or</span>
          <span className="h-px flex-1 bg-dark-line" />
        </div>
      )}
      {magicLink &&
        (sent ? (
          <p className="border border-dark-line px-4 py-3 font-mono text-xs uppercase leading-relaxed tracking-[.04em] text-cream-dim">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2.5">
            <label className="font-mono text-[10px] uppercase tracking-[.06em] text-cream-muted" htmlFor="email">
              Email
            </label>
            <div className="flex gap-2">
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="YOU@EXAMPLE.COM"
                className="min-w-0 flex-1 border border-dark-line bg-[#111] px-3 py-2.5 font-mono text-xs text-paper outline-none placeholder:text-cream-muted focus:border-paper"
              />
              <button
                type="submit"
                className="-skew-x-[5deg] bg-paper px-4 py-2 font-display text-[13px] font-bold uppercase tracking-[.06em] text-ink hover:opacity-90"
              >
                Send link
              </button>
            </div>
            {error && (
              <p role="alert" className="font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">
                {error}
              </p>
            )}
          </form>
        ))}
    </div>
  );
}
```

`apps/web/src/components/login-form.test.tsx` (full replacement):

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  test("renders only configured providers; discord gets blurple", () => {
    render(<LoginForm providers={["discord", "google"]} magicLink={false} onMagicLink={async () => {}} onSocial={() => {}} />);
    expect(screen.getByRole("button", { name: "Continue with discord" }).className).toContain("bg-discord");
    expect(screen.getByRole("button", { name: "Continue with google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with github" })).not.toBeInTheDocument();
  });

  test("social click delegates the provider", () => {
    const onSocial = vi.fn();
    render(<LoginForm providers={["discord"]} magicLink={false} onMagicLink={async () => {}} onSocial={onSocial} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with discord" }));
    expect(onSocial).toHaveBeenCalledWith("discord");
  });

  test("magic link submits and shows the sent state", async () => {
    const onMagicLink = vi.fn(async () => {});
    render(<LoginForm providers={[]} magicLink onMagicLink={onMagicLink} onSocial={() => {}} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    await waitFor(() => expect(screen.getByText("Check your email for a sign-in link.")).toBeInTheDocument());
    expect(onMagicLink).toHaveBeenCalledWith("a@b.co");
  });

  test("magic link failure shows the alert", async () => {
    render(
      <LoginForm providers={[]} magicLink onMagicLink={async () => { throw new Error("x"); }} onSocial={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not send the link. Try again."));
  });

  test("nothing configured: honest notice", () => {
    render(<LoginForm providers={[]} magicLink={false} onMagicLink={async () => {}} onSocial={() => {}} />);
    expect(screen.getByText("No sign-in methods are currently available.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the login tests**

Run: `pnpm --filter web test -- run src/components/login-form.test.tsx`
Expected: PASS.

- [ ] **Step 3: Restyle the login page shell**

`apps/web/src/app/login/page.tsx` (full replacement — keep the existing doc comment on the methods fetch):

```tsx
import { LoginPanel } from "@/components/login-panel";
import { getAuthMethods } from "@/lib/api";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  // The methods fetch is server-side to the co-located API; if it fails the API is down,
  // so no sign-in method (magic link included) can actually work. Show an honest unavailable
  // state rather than guessing a method that may be disabled or broken.
  const methods = await getAuthMethods().catch(() => null);
  return (
    <main className="mx-auto w-full max-w-md px-6 py-12">
      <p className="font-display text-sm font-bold uppercase tracking-[.14em] text-red">The front desk</p>
      <h1 className="mt-1 font-display text-4xl font-bold uppercase leading-[.95] text-ink">Get in the paper.</h1>
      <p className="mt-2 font-mono text-[11.5px] uppercase tracking-[.03em] text-ink-muted">
        Sign in, claim your gamertag, and your deaths make the paper.
      </p>
      <div className="mt-6">
        {methods ? (
          <LoginPanel providers={methods.providers} magicLink={methods.magicLink} />
        ) : (
          <p role="alert" className="border border-dashed border-dash px-4 py-3 font-mono text-xs uppercase tracking-[.04em] text-red-deep">
            Sign-in is temporarily unavailable. Please try again in a moment.
          </p>
        )}
      </div>
    </main>
  );
}
```

(If `apps/web/src/app/login/page.tsx` already exports metadata or is covered by a page test, reconcile — the title template appends `· One Life`.)

- [ ] **Step 4: Error + 404 on new tokens**

`apps/web/src/app/not-found.tsx` (full replacement):

```tsx
import { SkewCta } from "@/components/tabloid/skew-cta";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-center">
      <p className="font-display text-sm font-bold uppercase tracking-[.14em] text-red">404</p>
      <h1 className="mt-1 font-display text-4xl font-bold uppercase text-ink">Not found</h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-[.04em] text-ink-muted">
        That page doesn&rsquo;t exist. The trail goes cold here.
      </p>
      <div className="mt-6">
        <SkewCta href="/">Front page →</SkewCta>
      </div>
    </main>
  );
}
```

`apps/web/src/app/error.tsx` (full replacement):

```tsx
"use client";
import { SkewCta } from "@/components/tabloid/skew-cta";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-center">
      <p className="font-display text-sm font-bold uppercase tracking-[.14em] text-red">Stop the presses</p>
      <h1 className="mt-1 font-display text-4xl font-bold uppercase text-ink">Something went wrong</h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-[.04em] text-ink-muted">
        We couldn&rsquo;t load this page. The server may be temporarily unavailable.
      </p>
      <div className="mt-6">
        <SkewCta onClick={reset}>Try again</SkewCta>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Delete the ui primitives**

```bash
grep -rn "components/ui\|@/components/ui" apps/web/src --include='*.ts*'
```
Expected: no hits (all consumers were deleted in Task 11 or rewritten here). Then:

```bash
git rm -r apps/web/src/components/ui
```

- [ ] **Step 6: Run web suite + typecheck**

Run: `pnpm --filter web test -- run && pnpm turbo run typecheck --filter=web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): tabloid login, error and 404 pages; delete legacy ui primitives"
```

---

### Task 13: Token endgame — delete legacy aliases, `tint` → `bone`

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/tailwind.config.ts`
- Modify: every remaining `tint` consumer (grep-driven; expected: `components/skeletons.tsx`, `components/survivors/survivors-board.tsx`, `components/survivors/survivor-row.tsx`, `components/player/player-avatar.tsx`, `components/player/self-unban-button.tsx`, `components/controls/rail.tsx`, plus any test asserting `bg-tint`)

**Interfaces:**
- Produces: token surface is final — no legacy aliases, no `font-hand`, `bone` is the brand surface color. Task 14's `CharacterImage` uses `bg-bone`.

- [ ] **Step 1: Pre-flight grep — no legacy consumers left**

```bash
grep -rEn "(^|[^-a-z])(bg-bg|bg-panel-2|bg-panel|border-line|text-bone|bg-bone|text-dim|text-muted|bg-muted|text-amber|bg-amber|border-amber|hover:border-amber|text-blood|text-steel|bg-wash|font-hand)([^-a-z]|$)" apps/web/src --include='*.ts*'
```
Expected: **no hits** (Tasks 11–12 deleted/rewrote every consumer). If anything appears, sweep it to the new-token equivalent (`text-blood`→`text-red-deep` for small text, `text-muted`→`text-ink-muted`, `border-line`→`border-hairline`, `bg-panel`→`bg-tint`) before proceeding.

- [ ] **Step 2: Delete the aliases from `globals.css` and rename the variable**

In `apps/web/src/app/globals.css`: delete the whole `/* Legacy aliases … */` block (lines defining `--bg` through `--steel`), and change

```css
  --tint: 238 240 221;       /* #EEF0DD — brand "Bone" surface (see note) */
```

to

```css
  --bone: 238 240 221;       /* #EEF0DD — brand "Bone" surface */
```

- [ ] **Step 3: Update `tailwind.config.ts`**

Delete the whole `// Legacy aliases — compat only, removed end of R3` block (keys `bg, panel, panel-2, line, bone, dim, muted, amber, blood, steel, wash`), change `tint: v("tint"),` to `bone: v("bone"),`, and delete the `hand: [...]` entry (and its comment) from `fontFamily`.

- [ ] **Step 4: Sweep `tint` classes to `bone`**

```bash
grep -rln "tint" apps/web/src --include='*.ts*'
```
In every hit, replace `bg-tint` → `bg-bone` (also `text-tint`/`border-tint` if any exist). Include test files that assert the class. Then verify:

```bash
grep -rn "tint" apps/web/src --include='*.ts*' ; grep -rn "font-hand" apps/web/src --include='*.ts*'
```
Expected: both empty.

- [ ] **Step 5: Run web suite + typecheck (class-string assertions may have changed)**

Run: `pnpm --filter web test -- run && pnpm turbo run typecheck --filter=web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web
git commit -m "refactor(web): delete legacy token aliases and font-hand; rename tint to bone"
```

---

### Task 14: R1/R2 carried-forward consolidation

**Files:**
- Create: `apps/web/src/components/pagination-box.ts`
- Create: `apps/web/src/components/character-image.tsx`
- Create: `apps/web/src/components/player/stat.tsx`
- Modify: `apps/web/src/components/survivors/pagination.tsx`, `apps/web/src/components/player/player-pagination.tsx` (shared box classes)
- Modify: `apps/web/src/components/player/player-avatar.tsx` (wrapper over CharacterImage), `apps/web/src/components/survivors/survivor-row.tsx` (Portrait → CharacterImage)
- Modify: `apps/web/src/components/player/player-hero.tsx`, `apps/web/src/components/player/standing-card.tsx` (shared Stat)
- Modify: `apps/web/src/components/tabloid/skew-cta.tsx` (href|onClick union)
- Modify: `apps/web/src/components/skeletons.tsx` (podium tier; split dossier sections)
- Modify: `apps/web/src/lib/nav.ts` + its test (exact-segment matching)
- Modify: `apps/web/src/app/about/page.tsx` (`countWord` pluralization)
- Modify: `apps/web/src/components/player/past-life-card.tsx` (kills pluralization)

**Interfaces:**
- Produces: `pageBox/pageBoxLink/pageBoxOff` class strings; `CharacterImage({ character, size, dim })` + `characterSrc`; `Stat({ value, label, size, hot, muted })`; `SkewCta` as a discriminated union.

- [ ] **Step 1: Shared pagination classes**

`apps/web/src/components/pagination-box.ts`:

```ts
/** Mono pagination box classes shared by the survivors and dossier pagers. */
export const pageBox =
  "flex min-h-[44px] min-w-[44px] items-center justify-center px-3 font-mono text-[12.5px] uppercase";
export const pageBoxLink = "border border-dash text-ink hover:border-ink";
export const pageBoxOff = "select-none border border-hairline-2 text-ink-muted opacity-60";
```

In `survivors/pagination.tsx` and `player/player-pagination.tsx`: delete the local `box`/`boxLink`/`boxOff` constants, `import { pageBox, pageBoxLink, pageBoxOff } from "@/components/pagination-box";`, and substitute the names 1:1 (the player pager's `px-4` variant folds into `pageBox` — the extra `min-w` is harmless there).

- [ ] **Step 2: Shared decorative character image (also fixes the double `aria-hidden`)**

`apps/web/src/components/character-image.tsx`:

```tsx
import { cn } from "@/lib/utils";

type Character = { name: string | null } | null;

/** Portrait asset path for a roster character, or null (callers render the silhouette). */
export function characterSrc(character: Character): string | null {
  if (!character || !character.name) return null;
  return `/characters/${character.name.toLowerCase()}.webp`;
}

/** Decorative character portrait with silhouette fallback. alt="" — never given a role. */
export function CharacterImage({ character, size, dim = false }: { character: Character; size: number; dim?: boolean }) {
  const src = characterSrc(character);
  const box = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={box}
        className={cn("border border-hairline object-cover", dim && "opacity-60 grayscale")}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={box}
      className={cn("flex items-center justify-center border border-hairline bg-bone text-ink-muted", dim && "opacity-60")}
    >
      {/* parent is aria-hidden — no second aria-hidden on the svg */}
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}
```

`apps/web/src/components/player/player-avatar.tsx` becomes a one-line wrapper (callers untouched):

```tsx
import { CharacterImage } from "@/components/character-image";
import type { PlayerCharacter } from "@/lib/types";

export function PlayerAvatar({ character, size = 44, dim = false }: { character: PlayerCharacter | null; size?: number; dim?: boolean }) {
  return <CharacterImage character={character} size={size} dim={dim} />;
}
```

In `survivors/survivor-row.tsx`: delete the local `Portrait` component and its `avatarSrc` import; `import { CharacterImage } from "@/components/character-image";` and replace `<Portrait row={row} size={N} />` with `<CharacterImage character={row.character} size={N} />`. Then check whether `avatarSrc` in `survivors/format.ts` and `player/format.ts` still has consumers (`grep -rn "avatarSrc" apps/web/src`); if not, delete both functions and their tests (the logic now lives in `characterSrc`).

- [ ] **Step 3: Shared Stat**

`apps/web/src/components/player/stat.tsx`:

```tsx
import { cn } from "@/lib/utils";

/** Dossier stat: big display value over a mono label (hero band lg, standing cards md). */
export function Stat({
  value,
  label,
  size = "md",
  hot = false,
  muted = false,
}: {
  value: string;
  label: string;
  size?: "md" | "lg";
  hot?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <span
        className={cn(
          "block font-display font-bold leading-none",
          size === "lg" ? "text-[32px]" : "text-[21px]",
          hot ? "text-red" : muted ? "text-dash" : "text-ink",
        )}
      >
        {value}
      </span>
      <span
        className={cn(
          "block font-mono uppercase text-ink-muted",
          size === "lg" ? "mt-1 text-[10px] tracking-[.08em]" : "mt-0.5 text-[9.5px] tracking-[.07em]",
        )}
      >
        {label}
      </span>
    </div>
  );
}
```

In `player-hero.tsx`: replace the inline stat `<div>` markup in the stats map with `<Stat key={st.label} value={st.value} label={st.label} size="lg" hot={st.hot} />` (import from `./stat`). In `standing-card.tsx`: delete the local `Stat` function and import the shared one (call sites unchanged — the default `md` matches the old classes).

- [ ] **Step 4: SkewCta discriminated union**

`apps/web/src/components/tabloid/skew-cta.tsx` — replace the props type and signature:

```tsx
type Common = { tone?: keyof typeof tones; children: ReactNode };
type AsLink = Common & { href: string; onClick?: never; disabled?: never };
type AsButton = Common & { onClick: () => void; href?: never; disabled?: boolean };

export function SkewCta(props: AsLink | AsButton) {
  const className = cn(base, tones[props.tone ?? "red"]);
  if ("href" in props && props.href !== undefined) {
    return <Link href={props.href} className={className}>{props.children}</Link>;
  }
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} className={className}>
      {props.children}
    </button>
  );
}
```

Run typecheck — every existing call site passes exactly one of `href`/`onClick` already.

- [ ] **Step 5: Skeleton fidelity**

In `apps/web/src/components/skeletons.tsx`, replace the row block of `BoardSkeleton` (hero bar + 9 compact rows) with hero + 2 podium + 7 compact:

```tsx
      <div className="border-b border-hairline py-4">
        <Bar className="h-[76px]" />
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={`p${i}`} className="border-b border-hairline py-3.5">
          <Bar className="h-[60px]" />
        </div>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="border-b border-hairline-2 py-3">
          <Bar className="h-6" />
        </div>
      ))}
```

And in `DossierSkeleton`, replace the trailing merged grid with sectioned blocks mirroring the dossier (standing header + two cards, funerals header + two cards):

```tsx
      <div className="mt-7">
        <Bar className="h-5 w-44" />
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          <Bar className="h-40" />
          <Bar className="h-40" />
        </div>
      </div>
      <div className="mt-8">
        <Bar className="h-5 w-56" />
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          <Bar className="h-32" />
          <Bar className="h-32" />
        </div>
      </div>
```

Update `skeletons.test.tsx` if it counts bars (adjust expected counts to the new structure).

- [ ] **Step 6: `activeNavKey` exact segments + `countWord`/kills pluralization**

`apps/web/src/lib/nav.ts` — replace the helper body:

```ts
const inSection = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

/** Which nav item a pathname lights up. Player pages belong to the Survivors section. */
export function activeNavKey(pathname: string): NavKey | null {
  if (inSection(pathname, "/news")) return "news";
  if (inSection(pathname, "/obituaries")) return "obituaries";
  if (inSection(pathname, "/fresh-spawns")) return "fresh-spawns";
  if (inSection(pathname, "/survivors") || inSection(pathname, "/players")) return "survivors";
  if (inSection(pathname, "/about")) return "about";
  return null;
}
```

Add to the nav test file (`apps/web/src/lib/nav.test.ts`):

```ts
test("a lookalike segment does not light the section", () => {
  expect(activeNavKey("/newsroom")).toBe(null);
  expect(activeNavKey("/news/some-story")).toBe("news");
});
```

`apps/web/src/app/about/page.tsx`: change the servers heading line to

```tsx
            {countWord(servers.length)} server{servers.length === 1 ? "" : "s"}
```

`apps/web/src/components/player/past-life-card.tsx`: change `<span>{life.kills} kills</span>` to

```tsx
        <span>{life.kills} kill{life.kills === 1 ? "" : "s"}</span>
```

- [ ] **Step 7: Run the affected suites**

Run: `pnpm --filter web test -- run src/components/survivors src/components/player src/lib/nav.test.ts src/components/skeletons.test.tsx`
Expected: PASS (update any test that asserted the old local `box` constants or `Portrait` internals — the DOM queries via `container.querySelector("img")` keep working).

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src
git commit -m "refactor(web): consolidate pagination boxes, character image, stat; skeleton fidelity; nav + plural fixes"
```

---

### Task 15: Test hygiene (R2 review list)

**Files:**
- Modify: `apps/web/src/components/player/player-hero.test.tsx`
- Modify: `apps/web/src/components/player/format.ts` + `format.test.ts` (typed `aliveMaps` fixture)
- Modify: `apps/web/src/components/player/past-life-card.test.tsx`

**Interfaces:**
- Consumes: existing components; no production behavior changes except the `aliveMaps` parameter type widening.

- [ ] **Step 1: Fix the hero assertion**

In `player-hero.test.tsx`, add `within` to the Testing Library import and replace the `previousElementSibling` test body:

```tsx
  test("Deaths is the red stat", () => {
    render(<PlayerHero page={page()} />);
    const block = screen.getByText("Deaths").closest("div")!;
    const value = within(block).getByText((_, el) => el?.tagName === "SPAN" && el.className.includes("font-display"));
    expect(value.className).toContain("text-red");
  });
```

(If the simpler `within(block).getByText(String(page().totals.deaths))` is unambiguous in that fixture, prefer it.)

- [ ] **Step 2: Type the `aliveMaps` fixture**

In `apps/web/src/components/player/format.ts`, narrow the parameter structurally so tests don't need a cast:

```ts
export function aliveMaps(page: { standing: Array<Pick<ServerStanding, "state" | "map">> }): string[] {
  return page.standing.filter((s) => s.state === "alive").map((s) => mapLabel(s.map));
}
```

(add `import type { ServerStanding } from "@/lib/types";` — keep the existing `PlayerPage` import if still used elsewhere; `PlayerHero`'s call site still typechecks because `PlayerPage["standing"]` satisfies the pick). In `format.test.ts`, drop the `as never`:

```ts
    const standing: Array<Pick<ServerStanding, "state" | "map">> = [
      { state: "alive", map: "sakhal" },
      { state: "banned", map: "chernarusplus" },
      { state: "alive", map: "enoch" },
    ];
    expect(aliveMaps({ standing })).toEqual(["Sakhal", "Livonia"]);
```

(with `import type { ServerStanding } from "@/lib/types";` at the top).

- [ ] **Step 3: Pin the funeral card death line**

Append to `past-life-card.test.tsx` (reuse the file's existing fixture helper if it has one; otherwise this standalone fixture):

```tsx
const pvpUnknown = {
  lifeId: 99, serverId: 1, map: "sakhal", slug: "sakhal", lifeNumber: 2,
  startedAt: "2026-07-01T00:00:00Z", endedAt: "2026-07-02T00:00:00Z", timeAliveSeconds: 3600,
  kills: 1, longestKillMeters: null, character: null,
  death: { cause: "pvp", byGamertag: null, weapon: null, distanceMeters: null },
  vitals: { energy: null, water: null, bleedSources: null }, sessions: 1, killList: [],
};

test("pvp death with an unknown killer reads 'Killed by unknown'", () => {
  render(<PastLifeCard life={pvpUnknown} now={new Date("2026-07-10T00:00:00Z")} />);
  expect(screen.getByText(/Killed by\s*unknown/)).toBeInTheDocument();
});

test("named killer line pins the 'Killed by' prefix and singular kill count", () => {
  render(
    <PastLifeCard
      life={{ ...pvpUnknown, death: { cause: "pvp", byGamertag: "YrJustBad", weapon: "VSS", distanceMeters: 5 } }}
      now={new Date("2026-07-10T00:00:00Z")}
    />,
  );
  expect(screen.getByText(/Killed by/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "YrJustBad" })).toBeInTheDocument();
  expect(screen.getByText("1 kill")).toBeInTheDocument();
});
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter web test -- run src/components/player`
Expected: PASS.

```bash
git add apps/web/src/components/player
git commit -m "test(web): pin funeral death lines, type aliveMaps fixture, sturdier hero assertion"
```

---

### Task 16: Full verification (controller-run)

No new files. The controller (not a subagent) runs:

- [ ] **Step 1:** Full suite: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1` — expect all packages green.
- [ ] **Step 2:** `pnpm turbo run typecheck` — expect green.
- [ ] **Step 3:** Grep gates (all must be empty): `grep -rn "tint" apps/web/src --include='*.ts*'`; `grep -rn "font-hand" apps/web/src`; the legacy-class grep from Task 13 Step 1; `grep -rn "serverId" apps/web/src --include='*.ts*'` (expect only non-GamertagLink uses: `Server`, `ServerStanding`, `Life`, etc.).
- [ ] **Step 4:** Chrome visual sweep (dev servers; DB `onelife_visual`): 1440px — signed-out rail CTA on `/`, `/survivors`, a dossier; signed-in states (unlinked link panel, pending prove-it if reachable, verified rail with server cards) via the test account; 1280px — rail still present (xl breakpoint); 1024/390px — no rail, pill renders signed-in with correct status line, sheet opens/closes (×, overlay, Escape), body scroll locks, focus returns; login page; 404 page; `/account` → 404; skip link + focus ring; verified stamp at 390px inside the sheet header. Banned-state card: unit-verified if no banned player exists in the snapshot.
- [ ] **Step 5:** Fix anything found, re-run the affected suite, commit.

---

## Execution notes

- Tasks 1–10 are additive and safe in any order that respects their Interfaces blocks; 11 wires and deletes; 12 depends on 11 (ui/ deletion needs account pages gone); 13 depends on 11+12 (legacy consumers gone); 14 depends on 13 (`bg-bone`); 15 anytime after 3; 16 last.
- Model guidance: Tasks 2, 5, 6, 7, 8 are transcription-heavy (complete code above) — cheapest tier. Tasks 1, 3, 4, 9, 10, 15 — mid tier. Tasks 11, 12, 13, 14 touch many files with judgment — mid tier with care. Reviewers mid tier; final whole-branch review on the most capable model.

