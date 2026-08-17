# API Client Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the endpoint catalog and framework-free client helpers out of `apps/web` into `packages/api-client` and `packages/client-logic`, so a second (mobile) client can consume them without duplicating endpoint definitions.

**Architecture:** `apps/web/src/lib/api.ts` mixes three things: transport (Next-specific — `next/headers` cookies, `next: { revalidate }` ISR), generic HTTP plumbing (`ApiError`, `parse`, `toBackendPath`), and a catalog of ~50 typed endpoint functions. The catalog and the plumbing move to `packages/api-client` behind a `Transport` interface; the Next-specific transport and the ISR-cached variants stay in web. `apps/web/src/lib/api.ts` survives as a thin binding-and-re-export module so **all 53 existing importers stay untouched**. Separately, pure display/projection helpers move to `packages/client-logic`.

**Tech Stack:** TypeScript (ESM), pnpm workspaces, turbo, vitest, Next.js 15.

**Spec:** `docs/superpowers/specs/2026-08-17-native-mobile-app-design.md` (§ Architecture — "New workspace members", "Shared pure logic", "Dependency rules")

## Corrections applied during execution

⚠️ **This plan's body is the historical record of what was planned, not what shipped.** Three
corrections were ruled in during execution and are NOT reflected in the task text below. Read
these first:

1. **Internal relative imports are EXTENSIONLESS, not `.js`-suffixed.** The task text prescribes
   `from "./error.js"` throughout. That is wrong for these packages: it resolves under `tsc` and
   vitest (`moduleResolution: "Bundler"`) but webpack cannot resolve `.js` against `.ts` sources,
   and it broke `next build`. Metro (React Native) would hit the same wall. The repo's
   `.js`-specifier convention applies to packages consumed by node/tsx, such as `apps/notifier` —
   not to these, which are bundler-consumed by design.
2. **`rememberMap` did NOT move to `packages/client-logic`.** It writes `document.cookie`, which
   does not exist in React Native, so it stays defined in `apps/web/src/lib/map-resolution.ts`.
   That shim is therefore not the bare `export *` the task text shows: it re-exports the package's
   four pure members and defines `rememberMap` locally.
3. **`apps/web/src/lib/slug.ts` also moved into the package,** as its own subpath, and
   `apps/web/src/components/player/format.ts` moved as `player-format.ts`. The task text's move
   list omits both. `slug.ts` was promoted rather than having `playerSlug` duplicated into
   `life-href.ts`, because duplicated URL-slug logic diverges silently — with no test or type
   error to catch it.

Also: the task text states `apps/web/src/lib/api.test.ts` holds 12 tests. It holds 10.

## Global Constraints

- **Behaviour must not change.** This is a pure refactor. `apps/web/src/lib/api.test.ts` (117 lines, covers `apiGet`, `apiSend`, `toBackendPath`, `uploadAvatar`, `ApiError`) must pass **unmodified** at the end. It is the regression gate; do not edit it.
- **All 53 importers of `@/lib/api` stay unchanged.** No call site edits. `lib/api.ts` re-exports every catalog member under its existing name.
- **Packages must not depend on `next` or `react`.** `packages/api-client` and `packages/client-logic` have no framework dependencies. Anything needing `next/headers`, `next: { revalidate }`, or JSX stays in `apps/web`.
- **`packages/api-client` must not depend on `packages/db`** (spec dependency rule — drizzle/`postgres` cannot run in React Native).
- Package scaffold convention, copied from `packages/tokens`: `"type": "module"`, `"main": "src/index.ts"`, `"exports": { ".": "./src/index.ts" }`, scripts `typecheck` (`tsc --noEmit`) and `test` (`vitest run`), `tsconfig.json` of exactly `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`, tests in `test/`.
- Root `tsconfig.base.json` sets `strict` and **`noUncheckedIndexedAccess`** — indexing an array or record yields `T | undefined`. Written code must satisfy this.
- Workspace dependency version string is `"workspace:*"`.
- Every ⚠️ comment in the moved code is load-bearing (repo house rule) — **move comments verbatim with their code**. Do not summarise, reflow, or drop them.

---

### Task 1: Scaffold `packages/api-client` with the HTTP plumbing

Moves the three framework-free primitives (`ApiError`, `parse`, `toBackendPath`) into a new package. Nothing consumes it yet.

**Files:**
- Create: `packages/api-client/package.json`
- Create: `packages/api-client/tsconfig.json`
- Create: `packages/api-client/vitest.config.ts`
- Create: `packages/api-client/src/error.ts`
- Create: `packages/api-client/src/parse.ts`
- Create: `packages/api-client/src/path.ts`
- Create: `packages/api-client/src/index.ts`
- Test: `packages/api-client/test/parse.test.ts`
- Test: `packages/api-client/test/path.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class ApiError extends Error` with `constructor(status: number, code: string, message?: string)` and public fields `status`, `code`; `name === "ApiError"`.
  - `function parse<T>(res: Response): Promise<T>`
  - `function toBackendPath(p: string): string`

- [ ] **Step 1: Create the package manifest**

Create `packages/api-client/package.json`:

```json
{
  "name": "@onelife/api-client",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/api-client/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Create `packages/api-client/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 2: Install so the workspace links the new package**

Run: `pnpm install`
Expected: succeeds; `packages/api-client` is picked up by the existing `pnpm-workspace.yaml` glob (`packages/*`).

- [ ] **Step 3: Write the failing tests**

Create `packages/api-client/test/path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toBackendPath } from "../src/path.js";

describe("toBackendPath", () => {
  it("strips the /api prefix from read/me/gamertag routes", () => {
    expect(toBackendPath("/api/servers")).toBe("/servers");
    expect(toBackendPath("/api/me")).toBe("/me");
  });

  it("leaves the auth prefix untouched", () => {
    expect(toBackendPath("/api/auth")).toBe("/api/auth");
    expect(toBackendPath("/api/auth/providers")).toBe("/api/auth/providers");
  });

  it("leaves a non-/api path untouched", () => {
    expect(toBackendPath("/media/x.png")).toBe("/media/x.png");
  });
});
```

Create `packages/api-client/test/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parse } from "../src/parse.js";
import { ApiError } from "../src/error.js";

function res(body: string, init: { status?: number } = {}): Response {
  return new Response(body, { status: init.status ?? 200 });
}

describe("parse", () => {
  it("returns parsed JSON on a 2xx", async () => {
    await expect(parse<{ a: number }>(res(JSON.stringify({ a: 1 })))).resolves.toEqual({ a: 1 });
  });

  it("returns null for an empty 2xx body", async () => {
    await expect(parse(res(""))).resolves.toBeNull();
  });

  it("throws ApiError carrying status and code on a non-2xx JSON body", async () => {
    const err = await parse(res(JSON.stringify({ error: "nope", message: "no" }), { status: 403 }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("nope");
    expect(err.message).toBe("no");
  });

  it("throws an ApiError (not a SyntaxError) on a non-JSON error body", async () => {
    const err = await parse(res("<html>502</html>", { status: 502 })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe("http_error");
  });

  it("throws invalid_response on a non-JSON 2xx body", async () => {
    const err = await parse(res("not json")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("invalid_response");
  });

  it("defaults the code to http_error when the error body has no error field", async () => {
    const err = await parse(res(JSON.stringify({ nope: 1 }), { status: 500 })).catch((e) => e);
    expect(err.code).toBe("http_error");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @onelife/api-client test`
Expected: FAIL — cannot resolve `../src/path.js` / `../src/parse.js` (modules do not exist yet).

- [ ] **Step 5: Write the implementation**

Create `packages/api-client/src/error.ts`:

```ts
export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? `${status} ${code}`);
    this.name = "ApiError";
  }
}
```

Create `packages/api-client/src/path.ts`:

```ts
/**
 * Backend mounts Better Auth under /api/auth but read/me/gamertag routes at root.
 * The client goes through the Next rewrite (which does this mapping itself), so
 * this is only used to build the absolute server-side URL.
 */
export function toBackendPath(p: string): string {
  if (p === "/api/auth" || p.startsWith("/api/auth/")) return p;
  if (p.startsWith("/api/")) return p.slice(4); // "/api/servers" -> "/servers"
  return p;
}
```

Create `packages/api-client/src/parse.ts`:

```ts
import { ApiError } from "./error.js";

export async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError(res.status, "http_error", text.slice(0, 200));
      throw new ApiError(res.status, "invalid_response", "Response was not valid JSON");
    }
  }
  if (!res.ok) {
    const code = (json && typeof json === "object" && "error" in json) ? String((json as { error: unknown }).error) : "http_error";
    const message = (json && typeof json === "object" && "message" in json) ? String((json as { message: unknown }).message) : undefined;
    throw new ApiError(res.status, code, message);
  }
  return json as T;
}
```

Create `packages/api-client/src/index.ts`:

```ts
export { ApiError } from "./error.js";
export { parse } from "./parse.js";
export { toBackendPath } from "./path.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/api-client test`
Expected: PASS — 9 tests.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @onelife/api-client typecheck`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/api-client pnpm-lock.yaml
git commit -m "feat(api-client): scaffold package with ApiError, parse and toBackendPath"
```

---

### Task 2: Move the DTO types into `packages/api-client`

`apps/web/src/lib/types.ts` is 307 lines of pure type declarations with zero runtime imports. It is the type source both clients need.

**Files:**
- Create: `packages/api-client/src/types.ts` (moved content)
- Modify: `packages/api-client/src/index.ts`
- Modify: `apps/web/src/lib/types.ts` (becomes a re-export)
- Modify: `apps/web/package.json` (add the dependency)

**Interfaces:**
- Consumes: `packages/api-client` from Task 1.
- Produces: every type currently exported by `apps/web/src/lib/types.ts` — `SiteStats`, `Server`, `RosterEntry`, `Profile`, `Life`, `LifeDetail`, `LeaderRow`, `Kill`, `Build`, `Me`, `GamertagLink`, `ClaimResult`, `PlayerPage`, `GlobalRosterEntry`, `GlobalLeaderRow`, `AuthMethods`, `SurvivorsPage`, `LifeTimelineData`, `ObituariesFeed`, `ObituaryArticle`, `NotificationsFeed`, `LifeTrack`, `SitemapData`, `MapShare`, `ServerStanding`, `PlayerKill`, `Session`, `DeathVerdictDto`, `EncounterDto`, and the rest — plus two types lifted out of `api.ts`: `TokenTransaction` and `TokenWalletData`.

- [ ] **Step 1: Move the file**

```bash
git mv apps/web/src/lib/types.ts packages/api-client/src/types.ts
```

- [ ] **Step 2: Add the two token types that currently live in `api.ts`**

Append to `packages/api-client/src/types.ts`:

```ts
export type TokenTransaction = { id: number; delta: number; kind: string; createdAt: string };
export type TokenWalletData = { balance: number; transactions: TokenTransaction[] };
```

Then delete those same two lines from `apps/web/src/lib/api.ts` (they are at lines 150-151, immediately above `export const getTokens`).

- [ ] **Step 3: Re-export the types from the package index**

Replace `packages/api-client/src/index.ts` with:

```ts
export { ApiError } from "./error.js";
export { parse } from "./parse.js";
export { toBackendPath } from "./path.js";
export type * from "./types.js";
```

`export type *` (not `export *`) keeps the type surface type-only, so no runtime import is emitted for a module that has no runtime content.

- [ ] **Step 4: Point web's `types.ts` at the package**

Create `apps/web/src/lib/types.ts` containing exactly:

```ts
// The DTO types now live in @onelife/api-client so the mobile client can share them.
// This module stays as the web app's import site: ~50 files import from "@/lib/types".
export type * from "@onelife/api-client";
```

- [ ] **Step 5: Declare the dependency**

In `apps/web/package.json`, add to `"dependencies"` (keeping the existing alphabetical grouping — it sorts before `@tanstack/react-query`):

```json
"@onelife/api-client": "workspace:*",
```

- [ ] **Step 6: Tell Next to transpile the workspace package**

The package ships raw TypeScript (`"main": "src/index.ts"`), which Next will not compile from `node_modules` by default. Modify `apps/web/next.config.ts`, adding `transpilePackages` to the config object:

```ts
const nextConfig: NextConfig = {
  // Workspace packages ship raw TS (main: src/index.ts) rather than built JS, so Next has to
  // run them through its own compiler. Without this, `next build` fails to parse their types.
  transpilePackages: ["@onelife/api-client"],
  async rewrites() {
```

Leave the rest of the file untouched.

- [ ] **Step 7: Install and typecheck**

Run: `pnpm install && pnpm --filter @onelife/web typecheck`
Expected: no output, exit 0. A failure here means a type was missed in the move — fix by ensuring it is exported from `packages/api-client/src/types.ts`.

- [ ] **Step 8: Run the web tests**

Run: `pnpm --filter @onelife/web test`
Expected: PASS, including `src/lib/api.test.ts` unmodified.

- [ ] **Step 9: Commit**

```bash
git add packages/api-client apps/web/src/lib/types.ts apps/web/src/lib/api.ts apps/web/package.json apps/web/next.config.ts pnpm-lock.yaml
git commit -m "refactor(api-client): move DTO types out of apps/web"
```

---

### Task 3: Add the `Transport` interface and the endpoint catalog

The catalog becomes a factory over an injected transport. Web will supply a Next-aware transport; mobile will later supply a bearer-token one.

**Files:**
- Create: `packages/api-client/src/transport.ts`
- Create: `packages/api-client/src/endpoints.ts`
- Modify: `packages/api-client/src/index.ts`
- Test: `packages/api-client/test/endpoints.test.ts`

**Interfaces:**
- Consumes: `parse`, `ApiError`, and the types from Tasks 1-2.
- Produces:
  - `type Transport = { get<T>(path: string): Promise<T>; send<T>(method: HttpSendMethod, path: string, body?: unknown): Promise<T> }`
  - `type HttpSendMethod = "POST" | "DELETE" | "PATCH"`
  - `function createApiClient(t: Transport): ApiClient`
  - `type ApiClient = ReturnType<typeof createApiClient>`

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/test/endpoints.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createApiClient } from "../src/endpoints.js";
import { ApiError } from "../src/error.js";
import type { Transport } from "../src/transport.js";

function fakeTransport(overrides: Partial<Transport> = {}) {
  const get = vi.fn(async () => ({}) as never);
  const send = vi.fn(async () => ({}) as never);
  return { transport: { get, send, ...overrides } as Transport, get, send };
}

describe("createApiClient", () => {
  it("routes a plain GET to the transport with the literal path", async () => {
    const { transport, get } = fakeTransport();
    await createApiClient(transport).getServers();
    expect(get).toHaveBeenCalledWith("/api/servers");
  });

  it("URL-encodes interpolated path segments", async () => {
    const { transport, get } = fakeTransport();
    await createApiClient(transport).getProfile(3, "a b/c");
    expect(get).toHaveBeenCalledWith("/api/servers/3/players/a%20b%2Fc");
  });

  it("URL-encodes query parameters", async () => {
    const { transport, get } = fakeTransport();
    await createApiClient(transport).searchClaimableGamertags("a&b");
    expect(get).toHaveBeenCalledWith("/api/players/search?q=a%26b");
  });

  it("routes a POST with its body to the transport", async () => {
    const { transport, send } = fakeTransport();
    await createApiClient(transport).claimGamertag("tag");
    expect(send).toHaveBeenCalledWith("POST", "/api/me/gamertag-links", { gamertag: "tag" });
  });

  it("sends a bodyless DELETE as undefined, not as an empty object", async () => {
    const { transport, send } = fakeTransport();
    await createApiClient(transport).removeAvatar();
    expect(send).toHaveBeenCalledWith("DELETE", "/api/me/avatar", undefined);
  });

  it("omits the page query for page 1 of a player page, and includes it beyond", async () => {
    const { transport, get } = fakeTransport();
    const api = createApiClient(transport);
    await api.getPlayerPage("slug");
    expect(get).toHaveBeenCalledWith("/api/players/slug");
    await api.getPlayerPage("slug", 3);
    expect(get).toHaveBeenCalledWith("/api/players/slug?page=3");
  });

  it("turns a 404 into null for the getOrNull endpoints", async () => {
    const get = vi.fn(async () => { throw new ApiError(404, "not_found"); });
    const api = createApiClient({ get, send: vi.fn() } as unknown as Transport);
    await expect(api.getPlayerPage("gone")).resolves.toBeNull();
  });

  it("rethrows a non-404 from a getOrNull endpoint (a 403 must not read as absent)", async () => {
    const get = vi.fn(async () => { throw new ApiError(403, "forbidden"); });
    const api = createApiClient({ get, send: vi.fn() } as unknown as Transport);
    await expect(api.getLifeTrack("chernarus", 2)).rejects.toBeInstanceOf(ApiError);
  });

  it("defaults the notifications page to 1", async () => {
    const { transport, get } = fakeTransport();
    await createApiClient(transport).getNotifications();
    expect(get).toHaveBeenCalledWith("/api/me/notifications?page=1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/api-client test`
Expected: FAIL — cannot resolve `../src/endpoints.js`.

- [ ] **Step 3: Write the transport interface**

Create `packages/api-client/src/transport.ts`:

```ts
export type HttpSendMethod = "POST" | "DELETE" | "PATCH";

/**
 * How a client actually talks to the API. The endpoint catalog is written once against this
 * interface; each client supplies its own implementation:
 *
 *   - apps/web forwards cookies server-side (next/headers) and uses `credentials: "include"`
 *     in the browser.
 *   - the mobile client attaches `Authorization: Bearer <token>` from secure storage.
 *
 * Implementations are responsible for resolving the path to a URL and for running the response
 * through `parse`, so a rejected request always surfaces as an `ApiError`.
 */
export type Transport = {
  get<T>(path: string): Promise<T>;
  send<T>(method: HttpSendMethod, path: string, body?: unknown): Promise<T>;
};
```

- [ ] **Step 4: Write the endpoint catalog**

Create `packages/api-client/src/endpoints.ts`. This is the catalog moved out of `apps/web/src/lib/api.ts`, rebound onto `t.get` / `t.send`. Every ⚠️ and explanatory comment moves verbatim.

```ts
import { ApiError } from "./error.js";
import type { Transport } from "./transport.js";
import type {
  Server, RosterEntry, Profile, Life, LifeDetail, LeaderRow, Kill, Build,
  Me, GamertagLink, ClaimResult, PlayerPage,
  GlobalRosterEntry, GlobalLeaderRow, AuthMethods, SurvivorsPage, LifeTimelineData,
  ObituariesFeed, ObituaryArticle,
  NotificationsFeed,
  LifeTrack,
  MapShare,
  TokenWalletData,
} from "./types.js";

export function createApiClient(t: Transport) {
  async function getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await t.get<T>(path);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  return {
    getAuthMethods: () => t.get<AuthMethods>("/api/auth/providers"),
    getServers: () => t.get<Server[]>("/api/servers"),
    /** Tier 2 of the map-resolution rule. Returns `{ slug: null }` (200) for a signed-out viewer —
     *  it is a hint, not a protected resource. Takes no subject; the session is the only input. */
    getLastPlayedMap: () => t.get<{ slug: string | null }>("/api/me/last-map"),
    getRoster: (serverId: number) => t.get<RosterEntry[]>(`/api/servers/${serverId}/roster`),
    getProfile: (serverId: number, gamertag: string) =>
      t.get<Profile>(`/api/servers/${serverId}/players/${encodeURIComponent(gamertag)}`),
    getLives: (serverId: number, gamertag: string) =>
      t.get<Life[]>(`/api/servers/${serverId}/players/${encodeURIComponent(gamertag)}/lives`),
    getLifeDetail: (serverId: number, lifeId: number) =>
      t.get<LifeDetail>(`/api/servers/${serverId}/lives/${lifeId}`),
    getLeaderboard: (serverId: number, board: string) =>
      t.get<LeaderRow[]>(`/api/servers/${serverId}/leaderboards/${board}`),
    getGlobalRoster: () => t.get<GlobalRosterEntry[]>(`/api/roster`),
    getGlobalBoard: (board: string) => t.get<GlobalLeaderRow[]>(`/api/leaderboards/${board}`),
    getKills: (serverId: number) => t.get<Kill[]>(`/api/servers/${serverId}/kills`),
    getBuilds: (serverId: number) => t.get<Build[]>(`/api/servers/${serverId}/builds`),
    getMe: () => t.get<Me>("/api/me"),
    getGamertagLinks: () => t.get<GamertagLink[]>("/api/me/gamertag-links"),
    getGamertagLink: (id: number) => t.get<GamertagLink>(`/api/me/gamertag-links/${id}`),
    claimGamertag: (gamertag: string) =>
      t.send<ClaimResult>("POST", "/api/me/gamertag-links", { gamertag }),
    cancelGamertagLink: (id: number) =>
      t.send<{ status: string }>("DELETE", `/api/me/gamertag-links/${id}`),
    searchClaimableGamertags: (q: string) =>
      t.get<string[]>(`/api/players/search?q=${encodeURIComponent(q)}`),
    searchVerifiedGamertags: (q: string) =>
      t.get<string[]>(`/api/players/search/verified?q=${encodeURIComponent(q)}`),

    getTokens: () => t.get<TokenWalletData>("/api/me/tokens"),
    redeemToken: (banId?: number) =>
      t.send<{ lifted: { banId: number; gamertag: string } }>("POST", "/api/me/tokens/redeem", banId ? { banId } : {}),
    transferToken: (toGamertag: string) =>
      t.send<{ ok: true }>("POST", "/api/me/tokens/transfer", { toGamertag }),
    createCheckout: () => t.send<{ url: string }>("POST", "/api/me/tokens/checkout", {}),
    confirmCheckout: (sessionId: string) =>
      t.send<{ granted: number; paid: boolean; balance: number }>("POST", "/api/me/tokens/checkout/confirm", {
        sessionId,
      }),

    /** How many people the viewer referred who went on to verify. Takes no subject — session only. */
    getReferralCount: () => t.get<{ joined: number }>("/api/me/referrals"),
    /** Called server-side by the same-origin claim handler, which holds the httpOnly invite cookie. */
    postReferrerClaim: (referrerSlug: string) =>
      t.send<{ ok: true; claimed: boolean }>("POST", "/api/me/referrer/claim", { referrerSlug }),

    getNotifications: (page = 1) =>
      t.get<NotificationsFeed>(`/api/me/notifications?page=${page}`),
    markNotificationsRead: (ids: number[]) =>
      t.send<{ ok: true }>("POST", "/api/me/notifications/read", { ids }),
    getVapidKey: () => t.get<{ publicKey: string }>("/api/push/vapid-key"),
    subscribePush: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
      t.send<{ ok: true }>("POST", "/api/me/push-subscriptions", sub),
    unsubscribePush: (endpoint: string) =>
      t.send<{ ok: true }>("DELETE", "/api/me/push-subscriptions", { endpoint }),
    /** The server's view of this endpoint for the *session user*. The browser's PushSubscription
     *  survives sign-out, account switches and the notifier retiring the row, so it alone cannot
     *  tell the toggle whether push will actually arrive. */
    getPushStatus: (endpoint: string) =>
      t.get<{ active: boolean }>(`/api/me/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`),

    getPlayerPage: (slug: string, page?: number) =>
      getOrNull<PlayerPage>(`/api/players/${encodeURIComponent(slug)}${page && page > 1 ? `?page=${page}` : ""}`),

    getPlayerLife: (slug: string, map: string, n: number) =>
      getOrNull<LifeTimelineData>(`/api/players/${encodeURIComponent(slug)}/${encodeURIComponent(map)}/lives/${n}`),

    /** Owner-only. Wraps `getOrNull`, so a 404 (life does not exist) resolves to null. A 403
     *  (signed-in but not the verified owner) is NOT translated here — it rethrows, matching
     *  every other `getOrNull` wrapper in this file. Prefer `useLifeTrack`
     *  (`apps/web/src/lib/use-life-track`) as the entry point: its `queryFn` is what catches the
     *  403 and turns it into null so the UI doesn't distinguish "not found" from "not yours" for
     *  a stranger. A caller importing this function directly must handle the 403 itself. */
    getLifeTrack: (mapSlug: string, n: number) =>
      getOrNull<LifeTrack>(`/api/me/lives/${encodeURIComponent(mapSlug)}/${n}/track`),

    /** ⚠️ `slug` is REQUIRED — there is no combined board. A life is per-server, so a cross-server
     *  board would rank lives that were never in the same race. */
    getSurvivors: (p: { slug: string; page: number }) =>
      t.get<SurvivorsPage>(`/api/survivors/${encodeURIComponent(p.slug)}?page=${p.page}`),

    getObituariesFeed: (page: number) =>
      t.get<ObituariesFeed>(`/api/obituaries?page=${page}`),
    getObituary: (slug: string) =>
      getOrNull<ObituaryArticle>(`/api/obituaries/${encodeURIComponent(slug)}`),

    /** ⚠️ These three name a GRANTEE, which does not breach the no-subject rule: that rule governs
     *  coordinate EGRESS (whose position you may READ). These say who may see YOUR position, and
     *  disclose nothing in their responses. */
    shareLocationWith: (mapSlug: string, gamertag: string) =>
      t.send<{ ok: true }>("POST", `/api/me/maps/${encodeURIComponent(mapSlug)}/shares`, { gamertag }),
    stopSharingWith: (mapSlug: string, gamertag: string) =>
      t.send<{ ok: true }>("DELETE", `/api/me/maps/${encodeURIComponent(mapSlug)}/shares/${encodeURIComponent(gamertag)}`),
    stopSharingAll: (mapSlug: string) =>
      t.send<{ ok: true }>("DELETE", `/api/me/maps/${encodeURIComponent(mapSlug)}/shares`),

    getMapShare: (slug: string) =>
      t.get<MapShare>(`/api/me/maps/${encodeURIComponent(slug)}`),

    /** Session-gated, `no-store, private` — the viewer's own avatar hash, or null. Never derive an
     *  avatar from `useSession()`'s `user.image`: that's the raw provider URL, and public surfaces
     *  must not hotlink it.
     *
     *  ⚠️ The one exception is `AvatarPanel`'s "Use my Discord photo" preview
     *  (`components/account/avatar-panel.tsx`), and it is narrow enough not to reopen this rule: it
     *  renders `user.image` only to the signed-in owner, on the owner's own session-gated dialog,
     *  purely as a staged preview — the value is never persisted or forwarded anywhere (the actual
     *  photo comes from a server-side `syncAvatar()` fetch on Save, not from this URL) and never
     *  reaches an unauthenticated viewer. "Public surfaces must not hotlink it" is the rule this
     *  guards; a private owner-only preview of the owner's own value doesn't hotlink it to anyone. */
    getAvatar: () => t.get<{ hash: string | null }>("/api/me/avatar"),

    /** Pulls the login provider's avatar image and stores it as the user's avatar. 409
     *  `no_provider_image` when the provider gave us nothing to pull. */
    syncAvatar: () => t.send<{ hash: string }>("POST", "/api/me/avatar/sync"),

    /** Bodyless DELETE: transports only set content-type when a body is present. */
    removeAvatar: () => t.send<{ ok: true }>("DELETE", "/api/me/avatar"),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

// `SiteStats` and `SitemapData` have no endpoint here on purpose: their only callers are the web
// app's ISR-cached variants (`getSiteStatsCached`, `getSitemapData`), which depend on Next's
// `next: { revalidate }` fetch option and therefore stay in apps/web. Both types are still
// exported from ./types.js for those callers.
```

- [ ] **Step 5: Export the new surface from the index**

Replace `packages/api-client/src/index.ts` with:

```ts
export { ApiError } from "./error.js";
export { parse } from "./parse.js";
export { toBackendPath } from "./path.js";
export { createApiClient } from "./endpoints.js";
export type { ApiClient } from "./endpoints.js";
export type { Transport, HttpSendMethod } from "./transport.js";
export type * from "./types.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/api-client test`
Expected: PASS — 9 endpoint tests plus the 9 from Task 1.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @onelife/api-client typecheck`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/api-client
git commit -m "feat(api-client): add Transport interface and endpoint catalog factory"
```

---

### Task 4: Rewire `apps/web` onto the shared catalog

The Next-specific transport stays in web. `lib/api.ts` binds the catalog to it and re-exports every member under its existing name, so **no call site changes**.

**Files:**
- Modify: `apps/web/src/lib/api.ts` (replace lines 1-118 and 120-316; the ISR variants and `uploadAvatar` stay)
- Test: `apps/web/src/lib/api.test.ts` — **unmodified**, must still pass

**Interfaces:**
- Consumes: `createApiClient`, `Transport`, `ApiError`, `parse`, `toBackendPath` from `@onelife/api-client`.
- Produces: the identical named exports `apps/web` already imports — `apiGet`, `apiGetCached`, `apiSend`, `toBackendPath`, `ApiError`, `uploadAvatar`, `OBITUARY_REVALIDATE_SECONDS`, the `*Cached` variants, and every catalog member (`getServers`, `getMe`, `getPlayerPage`, …).

- [ ] **Step 1: Rewrite `apps/web/src/lib/api.ts`**

Replace the whole file with:

```ts
import {
  ApiError,
  createApiClient,
  parse,
  toBackendPath,
  type Transport,
} from "@onelife/api-client";
import type {
  SiteStats, Server, LifeTimelineData, ObituariesFeed, ObituaryArticle, SitemapData,
} from "./types";

// Re-exported so the ~53 modules importing these from "@/lib/api" keep working unchanged.
export { ApiError, toBackendPath };
export type { TokenTransaction, TokenWalletData } from "./types";

const isServer = typeof window === "undefined";
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

/** Server-side: absolute URL to the API origin (rewrites don't apply to server fetch). */
async function buildInit(base: RequestInit): Promise<{ url: (p: string) => string; init: RequestInit }> {
  if (isServer) {
    // Forward the incoming request's cookies so RSC fetches are authenticated.
    const { cookies } = await import("next/headers");
    const cookieHeader = (await cookies()).toString();
    return {
      url: (p) => `${API_ORIGIN}${toBackendPath(p)}`,
      init: { ...base, cache: "no-store", headers: { ...base.headers, cookie: cookieHeader } },
    };
  }
  // Defence-in-depth (spec §3.3): every response here can carry `Cache-Control:
  // no-store, private` (e.g. the owner-only life track), and the browser's own HTTP
  // cache must never be the reason a stale/foreign response is served. `credentials:
  // "include"` alone doesn't disable caching.
  return { url: (p) => p, init: { ...base, credentials: "include", cache: "no-store" } };
}

export async function apiGet<T>(path: string): Promise<T> {
  const { url, init } = await buildInit({ method: "GET" });
  return parse<T>(await fetch(url(path), init));
}

/**
 * Cacheable server-side GET for routes that must NOT depend on the request (e.g. `sitemap.ts`,
 * which needs `revalidate` to actually mean something). `apiGet`/`buildInit` await `cookies()`
 * and set `cache: "no-store"`, which opts the whole route out of static generation — that's
 * correct for authenticated RSC fetches but defeats ISR here. This variant never touches
 * `cookies()` and uses `next: { revalidate }` instead, so Next can cache and re-serve the
 * response. It also never forwards a cookie header to the API — pointless for an anonymous
 * enumeration endpoint, and a cache-poisoning vector once the response IS shared across
 * requests. Client-side callers don't need this: browser fetches already only cache what the
 * browser/CDN choose to, and don't run through `buildInit`'s server branch at all.
 */
// Plain `fetch` has no default timeout, so an API that is merely slow — rather than cleanly
// refusing — hangs the promise indefinitely, and a caller's try/catch can never fire because the
// promise never settles. An explicit timeout makes a slow or unreachable API reject quickly, so
// `sitemap.ts`'s try/catch degrades to a partial sitemap exactly as it does for a clean HTTP
// error. (This mattered acutely when the sitemap was briefly a static/ISR route: `next build`
// prerendered it, the fetch hung, and Next's 60s x3 build-worker budget failed the WHOLE build.
// The route is `force-dynamic` now, so that specific trap is gone — but a hung request is still
// worth bounding.)
const CACHED_FETCH_TIMEOUT_MS = 10_000;

export async function apiGetCached<T>(path: string, revalidateSeconds: number): Promise<T> {
  const url = `${API_ORIGIN}${toBackendPath(path)}`;
  const res = await fetch(url, {
    method: "GET",
    next: { revalidate: revalidateSeconds },
    signal: AbortSignal.timeout(CACHED_FETCH_TIMEOUT_MS),
  });
  return parse<T>(res);
}

export async function apiSend<T>(method: "POST" | "DELETE" | "PATCH", path: string, body?: unknown): Promise<T> {
  // Only send a content-type when there's actually a body. A bodyless request that still
  // declares `application/json` makes Fastify reject it with 400 (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which is what broke the bodyless DELETE for cancelling a gamertag claim.
  const { url, init } = await buildInit({
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  return parse<T>(await fetch(url(path), init));
}

/** The web app's transport: cookie-forwarding server-side, `credentials: "include"` in the
 *  browser. The mobile client supplies a bearer-token transport against the same interface. */
const webTransport: Transport = { get: apiGet, send: apiSend };

const api = createApiClient(webTransport);

// ── The shared catalog, re-exported one by one so every existing `import { getX } from
//    "@/lib/api"` keeps resolving. Do not collapse this into `export const { ... } = api` —
//    named re-exports are what keep the call sites and their types stable. ──
export const getAuthMethods = api.getAuthMethods;
export const getServers = api.getServers;
export const getLastPlayedMap = api.getLastPlayedMap;
export const getRoster = api.getRoster;
export const getProfile = api.getProfile;
export const getLives = api.getLives;
export const getLifeDetail = api.getLifeDetail;
export const getLeaderboard = api.getLeaderboard;
export const getGlobalRoster = api.getGlobalRoster;
export const getGlobalBoard = api.getGlobalBoard;
export const getKills = api.getKills;
export const getBuilds = api.getBuilds;
export const getMe = api.getMe;
export const getGamertagLinks = api.getGamertagLinks;
export const getGamertagLink = api.getGamertagLink;
export const claimGamertag = api.claimGamertag;
export const cancelGamertagLink = api.cancelGamertagLink;
export const searchClaimableGamertags = api.searchClaimableGamertags;
export const searchVerifiedGamertags = api.searchVerifiedGamertags;
export const getTokens = api.getTokens;
export const redeemToken = api.redeemToken;
export const transferToken = api.transferToken;
export const createCheckout = api.createCheckout;
export const confirmCheckout = api.confirmCheckout;
export const getReferralCount = api.getReferralCount;
export const postReferrerClaim = api.postReferrerClaim;
export const getNotifications = api.getNotifications;
export const markNotificationsRead = api.markNotificationsRead;
export const getVapidKey = api.getVapidKey;
export const subscribePush = api.subscribePush;
export const unsubscribePush = api.unsubscribePush;
export const getPushStatus = api.getPushStatus;
export const getPlayerPage = api.getPlayerPage;
export const getPlayerLife = api.getPlayerLife;
export const getLifeTrack = api.getLifeTrack;
export const getSurvivors = api.getSurvivors;
export const getObituariesFeed = api.getObituariesFeed;
export const getObituary = api.getObituary;
export const shareLocationWith = api.shareLocationWith;
export const stopSharingWith = api.stopSharingWith;
export const stopSharingAll = api.stopSharingAll;
export const getMapShare = api.getMapShare;
export const getAvatar = api.getAvatar;
export const syncAvatar = api.syncAvatar;
export const removeAvatar = api.removeAvatar;

// ── Next-only variants below. These depend on `next: { revalidate }` and have no mobile
//    equivalent, so they stay here rather than moving into @onelife/api-client. ──

/** `getOrNull`'s 404-to-null contract over the cookie-free, cacheable fetch. */
async function getOrNullCached<T>(path: string, revalidateSeconds: number): Promise<T | null> {
  try {
    return await apiGetCached<T>(path, revalidateSeconds);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Home's pitch feeds — public, cookie-independent, fetched on EVERY home render (cold AND
 *  signed-in, since the unverified pitch needs them too). `apiGetCached` keeps that free: no
 *  cookie forwarding, shared 60s fetch cache. Do NOT point authenticated surfaces at these. */
const HOME_FEED_REVALIDATE_SECONDS = 60;
/** ⚠️ Stays on the SIGNAL-BOUND `apiGetCached`: this feeds `/opengraph-image` and
 *  `/obituaries/opengraph-image`, both segment-less and therefore PRERENDERED by `next build`
 *  against an API that isn't serving. Without the bound the build hangs and fails. */
export const getSiteStatsCached = () => apiGetCached<SiteStats>("/api/stats", HOME_FEED_REVALIDATE_SECONDS);
export const getObituariesFeedCached = (page: number) =>
  apiGetCached<ObituariesFeed>(`/api/obituaries?page=${page}`, HOME_FEED_REVALIDATE_SECONDS);

/**
 * ⚠️ The obituary PAGE and its colocated `opengraph-image` must read through these, not through
 * `getObituary`/`getPlayerLife`. `apiGet` awaits `cookies()`, which opts the whole route out of
 * static rendering, and Next then emits `cache-control: private, no-cache, no-store` — so a CDN
 * cannot serve it and EVERY social-crawler scrape becomes a cold origin render (API fetch, font
 * load, PNG encode). Facebook's scraper has a short timeout and its fleet was intermittently
 * getting 418/timeout back, which publishes the post with a blank card; the manual Sharing
 * Debugger scrape succeeded at the same moment, which is what made this look intermittent rather
 * than structural. An obituary is immutable once filed, so serving crawlers from the edge costs
 * nothing. Both endpoints are public (`/api/obituaries/*`, `/api/players/*`) — the owner-gated
 * life track is `getLifeTrack` on `/api/me/*` and this page never touches it.
 * Do NOT point authenticated surfaces at these: no cookie is forwarded, and the response IS
 * shared across requests, so anything session-shaped would leak between viewers.
 * `revalidate` is kept in sync BY HAND with the two route files that set their own window.
 */
export const OBITUARY_REVALIDATE_SECONDS = 300;
export const getObituaryCached = (slug: string) =>
  getOrNullCached<ObituaryArticle>(`/api/obituaries/${encodeURIComponent(slug)}`, OBITUARY_REVALIDATE_SECONDS);
export const getPlayerLifeCached = (slug: string, map: string, n: number) =>
  getOrNullCached<LifeTimelineData>(
    `/api/players/${encodeURIComponent(slug)}/${encodeURIComponent(map)}/lives/${n}`,
    OBITUARY_REVALIDATE_SECONDS,
  );

/** Sitemap-only. Shares `revalidate` with `sitemap.ts` (kept in sync by hand — both currently
 *  3600) so the fetch cache and the route's own ISR window agree. */
const SITEMAP_REVALIDATE_SECONDS = 3600;
export const getSitemapData = () => apiGetCached<SitemapData>("/api/sitemap", SITEMAP_REVALIDATE_SECONDS);
/** Sitemap-only variant of `getServers()` — same endpoint, but cacheable/cookie-free. Do NOT
 *  point the regular `getServers()` (used by authenticated RSC pages) at this. */
export const getServersCached = () => apiGetCached<Server[]>("/api/servers", SITEMAP_REVALIDATE_SECONDS);

/**
 * Multipart upload — deliberately NOT routed through `apiSend`/`apiGet`: those always attach a
 * `content-type: application/json` header (when a body is present) and JSON-encode the body,
 * neither of which is right for a file. A raw `fetch` with a `FormData` body lets the browser
 * set its own `multipart/form-data; boundary=...` content-type; setting one by hand here would
 * omit the boundary and the server could never split the parts.
 *
 * Stays in apps/web rather than moving to @onelife/api-client: it takes a DOM `File`, which
 * React Native does not have (RN's FormData takes `{ uri, name, type }` instead).
 */
export async function uploadAvatar(file: File): Promise<{ hash: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/me/avatar", { method: "POST", body, credentials: "include", cache: "no-store" });
  return parse<{ hash: string }>(res);
}
```

- [ ] **Step 2: Run the web api tests — the regression gate**

Run: `pnpm --filter @onelife/web test -- src/lib/api.test.ts`
Expected: PASS, all 12 tests, with the test file unmodified.

If `uploadAvatar`'s test fails on a missing `content-type` assertion, the raw `fetch` was altered — restore it exactly as above.

- [ ] **Step 3: Run the full web suite**

Run: `pnpm --filter @onelife/web test`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @onelife/web typecheck`
Expected: no output, exit 0.

A likely failure here: a call site importing a type that used to be declared in `api.ts` (`TokenTransaction`, `TokenWalletData`). Those are re-exported at the top of the new file — confirm the `export type { … } from "./types"` line is present.

- [ ] **Step 5: Build, to prove `transpilePackages` is wired correctly**

Run: `pnpm --filter @onelife/web build`
Expected: build completes. A failure mentioning unexpected TypeScript syntax inside `@onelife/api-client` means `transpilePackages` from Task 2 Step 6 is missing or misspelled.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "refactor(web): bind the shared api-client catalog behind lib/api"
```

---

### Task 5: Extract `packages/client-logic`

Pure display and projection helpers that mobile needs. `components/player/format.ts` is included because two of the modules import it — and because it is pure logic misfiled under `components/`.

**Files:**
- Create: `packages/client-logic/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`
- Move: `apps/web/src/lib/{dayz-projection,map-grid,map-places,map-resolution,life-timeline,life-href,cause-format,format}.ts` and their `.test.ts` siblings, plus `map-places.json`
- Move: `apps/web/src/components/player/format.ts` → `packages/client-logic/src/player-format.ts`
- Modify: importers of the moved modules
- Modify: `apps/web/package.json`, `apps/web/next.config.ts`

**Interfaces:**
- Consumes: types from `@onelife/api-client` (`life-timeline.ts` imports `LifeTimelineData`, `PlayerKill`, `Session`, `DeathVerdictDto`, `EncounterDto`; `player-format.ts` imports `ServerStanding`).
- Produces: every existing export of the moved modules, unchanged — including `formatDuration`, `formatMeters`, `banCountdown`, `mapLabel`, `aliveMaps`, `heroStats`, `monthYear`, `monthDayYear`, `relativeDate` (from `player-format.ts`), and `worldSize`, `worldToPixel`, `worldToLatLng`, `MAP_WORLD_SIZE` (from `dayz-projection.ts`).

- [ ] **Step 1: Create the package scaffold**

Create `packages/client-logic/package.json`:

```json
{
  "name": "@onelife/client-logic",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    "./dayz-projection": "./src/dayz-projection.ts",
    "./map-grid": "./src/map-grid.ts",
    "./map-places": "./src/map-places.ts",
    "./map-resolution": "./src/map-resolution.ts",
    "./life-timeline": "./src/life-timeline.ts",
    "./life-href": "./src/life-href.ts",
    "./cause-format": "./src/cause-format.ts",
    "./format": "./src/format.ts",
    "./player-format": "./src/player-format.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@onelife/api-client": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

**⚠️ Per-module subpaths, and deliberately NO barrel `index.ts`.** `lib/format.ts` and
`components/player/format.ts` **both export `formatDuration`, with the same signature and
different behaviour** — `"3d 4h"` (days/hours/minutes, `s` under a minute) versus `"76h 30m"`
(hours and minutes only). A barrel `export *` drops a duplicated name from both sides silently,
and "resolving" the clash by picking one would change rendering at every call site of the other
**with no type error to catch it**. Subpath exports keep the two reachable under distinct
specifiers, so the clash cannot arise. Do not add a barrel later without renaming one of them
first, deliberately, with its call sites.

Create `packages/client-logic/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Create `packages/client-logic/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 2: Move the modules and their tests**

Tests move beside their sources into `src/` (these modules keep the co-located `*.test.ts` convention they already have; the `include` covers `src`).

```bash
cd apps/web/src/lib
git mv dayz-projection.ts dayz-projection.test.ts \
       map-grid.ts map-grid.test.ts \
       map-places.ts map-places.test.ts map-places.json \
       map-resolution.ts map-resolution.test.ts \
       life-timeline.ts life-timeline.test.ts \
       life-href.ts life-href.test.ts \
       cause-format.ts cause-format.test.ts \
       format.ts format.test.ts \
       ../../../../packages/client-logic/src/
cd ../../../..
git mv apps/web/src/components/player/format.ts packages/client-logic/src/player-format.ts
```

- [ ] **Step 3: Fix the imports inside the moved modules**

In `packages/client-logic/src/life-timeline.ts`, replace the first two lines:

```ts
import type { LifeTimelineData, PlayerKill, Session, DeathVerdictDto, EncounterDto } from "@onelife/api-client";
import { formatDuration } from "./player-format.js";
```

In `packages/client-logic/src/map-resolution.ts`, replace the first line:

```ts
import { mapLabel } from "./player-format.js";
```

In `packages/client-logic/src/player-format.ts`, replace the first line:

```ts
import type { ServerStanding } from "@onelife/api-client";
```

- [ ] **Step 4: Confirm there is no index barrel**

There is no `src/index.ts` in this package, by design (see the ⚠️ in Step 1). Consumers import
per module: `@onelife/client-logic/format`, `@onelife/client-logic/player-format`, and so on.

Verify nothing created one:

Run: `test ! -e packages/client-logic/src/index.ts && echo "no barrel - correct"`
Expected: `no barrel - correct`

- [ ] **Step 5: Point web at the package**

Add to `apps/web/package.json` dependencies:

```json
"@onelife/client-logic": "workspace:*",
```

Extend `transpilePackages` in `apps/web/next.config.ts`:

```ts
  transpilePackages: ["@onelife/api-client", "@onelife/client-logic"],
```

Create nine forwarding modules so web's existing import paths keep resolving. Each forwards to **its own** subpath — one line each, never the whole package:

| Create this file | Containing exactly |
| --- | --- |
| `apps/web/src/lib/dayz-projection.ts` | `export * from "@onelife/client-logic/dayz-projection";` |
| `apps/web/src/lib/map-grid.ts` | `export * from "@onelife/client-logic/map-grid";` |
| `apps/web/src/lib/map-places.ts` | `export * from "@onelife/client-logic/map-places";` |
| `apps/web/src/lib/map-resolution.ts` | `export * from "@onelife/client-logic/map-resolution";` |
| `apps/web/src/lib/life-timeline.ts` | `export * from "@onelife/client-logic/life-timeline";` |
| `apps/web/src/lib/life-href.ts` | `export * from "@onelife/client-logic/life-href";` |
| `apps/web/src/lib/cause-format.ts` | `export * from "@onelife/client-logic/cause-format";` |
| `apps/web/src/lib/format.ts` | `export * from "@onelife/client-logic/format";` |
| `apps/web/src/components/player/format.ts` | `export * from "@onelife/client-logic/player-format";` |

⚠️ The last two rows are the collision pair. `lib/format.ts` must forward to `/format` and
`components/player/format.ts` must forward to `/player-format`. Swapping them compiles cleanly
and silently changes every duration string on the player surfaces.

- [ ] **Step 5b: Pin the collision pair with a test**

`player-format.ts` currently has no test of its own, so nothing stops a future tidy-up from
merging the two `formatDuration`s. Create `packages/client-logic/src/player-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatDuration as playerFormatDuration } from "./player-format.js";
import { formatDuration as boardFormatDuration } from "./format.js";

describe("formatDuration is TWO different functions", () => {
  // ⚠️ Same name, same signature, different output. They are not interchangeable and must not
  // be merged: the player surfaces render hours-and-minutes, the boards render days-hours-minutes.
  it("player-format renders hours and minutes only, never days", () => {
    expect(playerFormatDuration(275_400)).toBe("76h 30m");
  });

  it("format rolls up into days", () => {
    expect(boardFormatDuration(275_400)).toBe("3d 4h 30m");
  });

  it("player-format floors a negative duration at zero", () => {
    expect(playerFormatDuration(-5)).toBe("0h 0m");
  });
});
```

Run: `pnpm --filter @onelife/client-logic test -- src/player-format.test.ts`
Expected: PASS. If the `3d 4h 30m` assertion fails, read the actual output and correct **the
test** to match `format.ts`'s real behaviour — do not change `format.ts`, which is under test by
its own moved suite.

- [ ] **Step 6: Install, then run the package tests**

Run: `pnpm install && pnpm --filter @onelife/client-logic test`
Expected: PASS — every moved test file runs green in its new home.

`map-places.ts` does `import data from "./map-places.json"`; `resolveJsonModule` is already on in `tsconfig.base.json`, so this needs no change.

- [ ] **Step 7: Typecheck the package and the web app**

Run: `pnpm --filter @onelife/client-logic typecheck && pnpm --filter @onelife/web typecheck`
Expected: no output, exit 0 for both.

- [ ] **Step 8: Run the full web suite**

Run: `pnpm --filter @onelife/web test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/client-logic apps/web pnpm-lock.yaml
git commit -m "refactor(client-logic): extract framework-free display and projection helpers"
```

---

### Task 6: Whole-repo verification and changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the whole repo's checks**

Run: `pnpm turbo run typecheck test --concurrency=1`
Expected: PASS across every package and app.

DB-backed suites need `TEST_DATABASE_URL`. Per `CLAUDE.md`, this machine's Postgres may be on a remapped port — check `docker ps`. Neither new package touches the database.

- [ ] **Step 2: Confirm no call sites were edited**

Run: `git diff --stat main -- apps/web/src | grep -v "src/lib/\|components/player/format"`
Expected: empty output. Any file listed is a call site that changed, which violates the plan's constraint — revert it and fix the forwarding module instead.

- [ ] **Step 3: Confirm the packages are framework-free**

Run: `grep -rn "from \"next\|from \"react" packages/api-client/src packages/client-logic/src`
Expected: no matches.

Run: `grep -rn "@onelife/db" packages/api-client packages/client-logic --include=*.ts --include=*.json`
Expected: no matches (spec dependency rule).

- [ ] **Step 4: Add the changelog entry**

Per `.keel.json` (`requireChangelog: true`), every contribution PR needs an entry, written last. Add under the `Unreleased` heading in `CHANGELOG.md`:

```markdown
### Changed

- Extracted the API endpoint catalog into `@onelife/api-client` and the framework-free display
  helpers into `@onelife/client-logic`, so a second client can share them. `apps/web` keeps its
  Next-specific transport and ISR-cached variants; no call sites changed.
```

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the api-client extraction"
```

---

## Notes for the executor

**What is deliberately NOT in this plan:** no `apps/mobile`, no bearer transport, no auth changes. The bearer transport is a ~15-line implementation of `Transport` and belongs in the mobile app's own plan. This plan's success condition is that `apps/web` behaves identically while the catalog becomes consumable from outside it.

**If the endpoint catalog and the web re-export list drift** (an endpoint added to one but not the other), `pnpm --filter @onelife/web typecheck` catches it only for endpoints that have a call site. A newly added endpoint with no web caller can be missed — add it to both.
