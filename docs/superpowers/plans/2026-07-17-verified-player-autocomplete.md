# Verified-Player Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the controls-rail "Send to verified player" and "Referred by" fields gamertag autocomplete sourced from verified players, excluding the signed-in user.

**Architecture:** A new `searchVerifiedGamertags` read-model + public `GET /players/search/verified` route mirror the existing claimable search. On the web, the debounce/race-guard/dropdown logic is extracted out of `LinkTagPanel` into a shared `<GamertagAutocomplete>`; the two token fields use it with a case-insensitive `exclude` set to the current player's gamertag (already in scope at both render sites).

**Tech Stack:** TypeScript/ESM monorepo (pnpm + turbo), Postgres + Drizzle, Fastify (API), Next.js + React + TanStack Query (web), Vitest + Testing Library.

## Global Constraints

- Language/module system: TypeScript, ESM. Intra-package imports use `.js` extensions (e.g. `from "../src/index.js"`); path alias `@/…` maps to `apps/web/src/…`.
- Verified gamertag = a `gamertag_links` row with `status = 'verified'`; that table is verified-unique on gamertag (migration `0006`) — no dedup needed.
- Gamertag matching/exclusion is **case-insensitive** everywhere (SQL `ilike`; client filter via `toLowerCase()`).
- The search route stays **public/unauthenticated**; exclusion of the current player happens **client-side only**.
- Autocomplete params match the existing claimable field exactly: **min 2 chars**, **200ms debounce**, **limit 10**, race-guarded, skip-search-after-pick.
- Presentational components are unit-tested; containers (`rail.tsx`, `mobile-controls.tsx`, `use-controls.ts`) stay thin and untested.
- DB test suites (Tasks 1–2) require `TEST_DATABASE_URL` (`docker compose up -d postgres`; this dev machine remaps the host port — see `docker-compose.override.yml`). Web tests (Tasks 3–5) run in jsdom, no DB.
- Commit staging: use explicit paths (never `git add -A` at repo root — untracked `.claude/hooks/__pycache__/` must not ride along).

---

### Task 1: `searchVerifiedGamertags` read-model

**Files:**
- Modify: `packages/read-models/src/claimable.ts`
- Test: `packages/read-models/test/claimable.test.ts` (append)

**Interfaces:**
- Consumes: `Database` (`@onelife/db`), `players`/`gamertagLinks` tables, drizzle `and/eq/ilike/asc`.
- Produces: `searchVerifiedGamertags(db: Database, prefix: string, limit: number): Promise<string[]>` — verified gamertags whose name starts with `prefix` (case-insensitive), ascending, capped at `limit`. Auto-exported via the barrel's `export * from "./claimable.js"`.

- [ ] **Step 1: Write the failing test**

Append to `packages/read-models/test/claimable.test.ts`. First update the import on line 4 to add the new symbol:

```ts
import { searchClaimableGamertags, searchVerifiedGamertags } from "../src/index.js";
```

Then add, after the existing `describe` block (the `beforeAll` already seeds `Alpha` verified, `Alalpha`/`Beta` unverified):

```ts
describe("searchVerifiedGamertags", () => {
  it("prefix-matches only verified gamertags, case-insensitively", async () => {
    expect(await searchVerifiedGamertags(db, "al", 10)).toEqual(["Alpha"]);
  });
  it("returns nothing when no verified gamertag matches the prefix", async () => {
    expect(await searchVerifiedGamertags(db, "Bet", 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/read-models exec vitest run test/claimable.test.ts`
Expected: FAIL — `searchVerifiedGamertags is not a function` / not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `packages/read-models/src/claimable.ts` (the `and, eq, ilike, asc` imports it needs already exist on line 3; `notExists` stays for the claimable query):

```ts
/** Verified gamertags (autocomplete source for token transfer + referral). */
export async function searchVerifiedGamertags(db: Database, prefix: string, limit: number): Promise<string[]> {
  const rows = await db.select({ g: gamertagLinks.gamertag }).from(gamertagLinks)
    .where(and(ilike(gamertagLinks.gamertag, `${prefix}%`), eq(gamertagLinks.status, "verified")))
    .orderBy(asc(gamertagLinks.gamertag)).limit(limit);
  return rows.map((r) => r.g);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/read-models exec vitest run test/claimable.test.ts`
Expected: PASS (both new cases + the pre-existing claimable case).

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/claimable.ts packages/read-models/test/claimable.test.ts
git commit -m "feat(read-models): searchVerifiedGamertags autocomplete query"
```

---

### Task 2: `GET /players/search/verified` route

**Files:**
- Modify: `apps/api/src/routes/players.ts`
- Test: `apps/api/test/players.test.ts` (append cases)

**Interfaces:**
- Consumes: `searchVerifiedGamertags` (Task 1) from `@onelife/read-models`.
- Produces: `GET /players/search/verified?q=<prefix>` → `string[]` (JSON). Trims `q`; `< 2` chars → `[]`; else up to 10 verified matches. Public, no auth.

- [ ] **Step 1: Write the failing test**

Append two cases inside the existing `describe("player + life routes", …)` block in `apps/api/test/players.test.ts` (the `beforeAll` already seeds `Alpha` verified + `Alalpha` unverified):

```ts
  it("returns verified gamertags matching a prefix", async () => {
    const res = await app.inject({ method: "GET", url: "/players/search/verified?q=Al" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(["Alpha"]);
  });
  it("returns an empty array below the min query length for the verified search", async () => {
    const res = await app.inject({ method: "GET", url: "/players/search/verified?q=A" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/api exec vitest run test/players.test.ts`
Expected: FAIL — the verified route 404s (route not registered), so `statusCode` is `404`, not `200`.

- [ ] **Step 3: Write the minimal implementation**

In `apps/api/src/routes/players.ts`, update the read-models import on line 4 to add `searchVerifiedGamertags`:

```ts
import { getPlayerProfile, getPlayerLives, getLifeDetail, searchClaimableGamertags, searchVerifiedGamertags } from "@onelife/read-models";
```

Then add the route immediately after the existing `/players/search` handler (after its closing `});`, before the `/servers/:serverId/players/:gamertag` route):

```ts
  app.get("/players/search/verified", async (req) => {
    const q = z.object({ q: z.string() }).safeParse(req.query);
    const prefix = q.success ? q.data.q.trim() : "";
    if (prefix.length < 2) return [];
    return searchVerifiedGamertags(db, prefix, 10);
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/api exec vitest run test/players.test.ts`
Expected: PASS (both new cases + all pre-existing player/life route cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/players.ts apps/api/test/players.test.ts
git commit -m "feat(api): GET /players/search/verified route"
```

---

### Task 3: `<GamertagAutocomplete>` shared component

**Files:**
- Create: `apps/web/src/components/controls/gamertag-autocomplete.tsx`
- Test: `apps/web/src/components/controls/gamertag-autocomplete.test.tsx`

**Interfaces:**
- Consumes: nothing app-specific — `fetchSuggestions` is injected as a prop (so the component is decoupled from `@/lib/api`).
- Produces: `GamertagAutocomplete` — a controlled input + suggestion dropdown. Props:
  ```ts
  {
    value: string;
    onChange: (v: string) => void;
    fetchSuggestions: (q: string) => Promise<string[]>;
    exclude?: string;              // filtered out case-insensitively (the current player)
    placeholder?: string;
    id?: string;
    "aria-label"?: string;
    className?: string;            // wrapper (the relative box) — e.g. "flex-1 min-w-0"
    inputClassName?: string;       // the <input> styling
  }
  ```
  Behavior: 200ms debounce; min-2-char gate; race guard (`searchSeq`); skip-search-after-pick (`skipSearch`); dropdown is an absolutely-positioned overlay. No wrapping `<form>` or submit button — the parent owns those and reads `value`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/controls/gamertag-autocomplete.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { GamertagAutocomplete } from "./gamertag-autocomplete";

function Harness({
  fetchSuggestions,
  exclude,
}: {
  fetchSuggestions: (q: string) => Promise<string[]>;
  exclude?: string;
}) {
  const [v, setV] = useState("");
  return (
    <GamertagAutocomplete
      value={v}
      onChange={setV}
      fetchSuggestions={fetchSuggestions}
      exclude={exclude}
      aria-label="Field"
    />
  );
}

describe("GamertagAutocomplete", () => {
  test("debounces, then suggests matches", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ot" } });
    expect(await screen.findByRole("button", { name: "OtherGuy" })).toBeInTheDocument();
    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchSuggestions).toHaveBeenCalledWith("Ot");
  });

  test("does not search below the 2-char minimum", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "O" } });
    await new Promise((r) => setTimeout(r, 250));
    expect(fetchSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "OtherGuy" })).not.toBeInTheDocument();
  });

  test("excludes the current player case-insensitively", async () => {
    const fetchSuggestions = vi.fn(async () => ["MeGamer", "OtherGuy"]);
    render(<Harness fetchSuggestions={fetchSuggestions} exclude="megamer" />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ga" } });
    expect(await screen.findByRole("button", { name: "OtherGuy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "MeGamer" })).not.toBeInTheDocument();
  });

  test("picking a suggestion fills the value and does not reopen the dropdown", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ot" } });
    fireEvent.click(await screen.findByRole("button", { name: "OtherGuy" }));
    expect((screen.getByLabelText("Field") as HTMLInputElement).value).toBe("OtherGuy");
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole("button", { name: "OtherGuy" })).not.toBeInTheDocument();
  });

  test("a stale slow response cannot overwrite newer results", async () => {
    const fetchSuggestions = vi.fn<(q: string) => Promise<string[]>>();
    let resolveFirst: (v: string[]) => void = () => {};
    fetchSuggestions.mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }));
    fetchSuggestions.mockImplementationOnce(async () => ["SecondResult"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ab" } });
    await new Promise((r) => setTimeout(r, 250)); // first (hanging) request issued
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Abc" } });
    await screen.findByRole("button", { name: "SecondResult" });
    resolveFirst(["FirstResult"]); // stale response lands late
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "FirstResult" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SecondResult" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web exec vitest run src/components/controls/gamertag-autocomplete.test.tsx`
Expected: FAIL — cannot resolve `./gamertag-autocomplete` (module does not exist).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/src/components/controls/gamertag-autocomplete.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

/** Controlled gamertag input with a debounced, race-guarded suggestion dropdown.
 *  `fetchSuggestions` is injected; `exclude` (case-insensitive) drops the current player. */
export function GamertagAutocomplete({
  value,
  onChange,
  fetchSuggestions,
  exclude,
  placeholder,
  id,
  "aria-label": ariaLabel,
  className,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  fetchSuggestions: (q: string) => Promise<string[]>;
  exclude?: string;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
  inputClassName?: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Race guards: drop out-of-order responses; don't re-search right after a pick.
  const searchSeq = useRef(0);
  const skipSearch = useRef(false);

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      const seq = ++searchSeq.current;
      fetchSuggestions(q)
        .then((results) => {
          if (seq !== searchSeq.current) return;
          const ex = exclude?.toLowerCase();
          setSuggestions(results.filter((r) => r.toLowerCase() !== ex));
        })
        .catch(() => {
          if (seq === searchSeq.current) setSuggestions([]);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [value, exclude, fetchSuggestions]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <input
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        placeholder={placeholder}
        className={inputClassName}
      />
      {suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 border border-t-0 border-dark-line bg-[#111]">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  skipSearch.current = true;
                  searchSeq.current++; // invalidate any in-flight search
                  onChange(s);
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
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/web exec vitest run src/components/controls/gamertag-autocomplete.test.tsx`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls/gamertag-autocomplete.tsx apps/web/src/components/controls/gamertag-autocomplete.test.tsx
git commit -m "feat(web): shared GamertagAutocomplete component"
```

---

### Task 4: Refactor `LinkTagPanel` onto `<GamertagAutocomplete>`

**Files:**
- Modify: `apps/web/src/components/controls/link-panel.tsx`
- Test (regression, unchanged): `apps/web/src/components/controls/link-verify-panels.test.tsx`

**Interfaces:**
- Consumes: `GamertagAutocomplete` (Task 3); `searchClaimableGamertags` (`@/lib/api`, unchanged).
- Produces: no API change to `LinkTagPanel` (`onClaim`/`pending`/`error` props unchanged). The existing `link-verify-panels.test.tsx` is the regression gate — it must stay green with no edits.

- [ ] **Step 1: Confirm the regression test currently passes (baseline)**

Run: `pnpm --filter @onelife/web exec vitest run src/components/controls/link-verify-panels.test.tsx`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Refactor the implementation**

Replace the body of `apps/web/src/components/controls/link-panel.tsx` with the version below. This deletes the inline `useState`/`useEffect`/`useRef` autocomplete machinery (now owned by `GamertagAutocomplete`) and the inline suggestions `<ul>`, keeping the section, `<form>`, submit button, error, and footnote identical. The `<label htmlFor="rail-gamertag">` stays in the parent and binds to the component's input via `id="rail-gamertag"`.

```tsx
"use client";
import { useState } from "react";
import { searchClaimableGamertags } from "@/lib/api";
import { GamertagAutocomplete } from "./gamertag-autocomplete";

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
        <GamertagAutocomplete
          id="rail-gamertag"
          value={tag}
          onChange={setTag}
          fetchSuggestions={searchClaimableGamertags}
          placeholder="GAMERTAG…"
          inputClassName="w-full border border-paper bg-[#111] px-3 py-2.5 font-mono text-[13px] tracking-[.04em] text-paper outline-none placeholder:text-cream-muted"
        />
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

- [ ] **Step 3: Run the regression test to verify it still passes**

Run: `pnpm --filter @onelife/web exec vitest run src/components/controls/link-verify-panels.test.tsx`
Expected: PASS — headline/strapline/footnote, suggest-and-pick, submit+error, skip-after-pick, and race-guard cases all green (behavior preserved; only the dropdown's positioning changed to an overlay, which the role/name queries don't observe).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/controls/link-panel.tsx
git commit -m "refactor(web): LinkTagPanel uses shared GamertagAutocomplete"
```

---

### Task 5: Wire the token fields to verified-search + exclude self

**Files:**
- Modify: `apps/web/src/lib/api.ts` (add client fn)
- Modify: `apps/web/src/components/controls/tokens-panel.tsx`
- Modify: `apps/web/src/components/controls/rail.tsx` (pass `myGamertag`)
- Modify: `apps/web/src/components/controls/mobile-controls.tsx` (pass `myGamertag`)
- Test: `apps/web/src/components/controls/tokens-panel.test.tsx`

**Interfaces:**
- Consumes: `GamertagAutocomplete` (Task 3); `searchVerifiedGamertags` client fn (added this task).
- Produces: `searchVerifiedGamertags(q: string): Promise<string[]>` (`@/lib/api`); `TokensPanel` gains an optional `myGamertag?: string` prop forwarded as `exclude` on both autocompletes.

- [ ] **Step 1: Write the failing test**

Edit `apps/web/src/components/controls/tokens-panel.test.tsx`. Add the import + module mock at the top (after the existing imports on lines 1–3), so the panel's new `@/lib/api` dependency is stubbed:

```tsx
import { searchVerifiedGamertags } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  searchVerifiedGamertags: vi.fn(async () => [] as string[]),
}));
```

Then add this test inside the existing `describe("TokensPanel", …)` block:

```tsx
  test("send suggests verified players and excludes the current player", async () => {
    vi.mocked(searchVerifiedGamertags).mockResolvedValueOnce(["MeGamer", "OtherGuy"]);
    render(
      <TokensPanel balance={2} myGamertag="MeGamer" send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Send a token to a verified player"), { target: { value: "Ga" } });
    expect(await screen.findByRole("button", { name: "OtherGuy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "MeGamer" })).not.toBeInTheDocument();
  });
```

(The `findByRole` import is already present — the file imports `screen, fireEvent` from `@testing-library/react`; add `waitFor` is not needed. Ensure `screen` supports `findByRole`, which it does.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web exec vitest run src/components/controls/tokens-panel.test.tsx`
Expected: FAIL — `TokensPanel` doesn't accept `myGamertag` / doesn't render suggestion buttons yet (the new case fails to find the `OtherGuy` button).

- [ ] **Step 3a: Add the web client function**

In `apps/web/src/lib/api.ts`, immediately after the existing `searchClaimableGamertags` export (lines 101–102), add:

```ts
export const searchVerifiedGamertags = (q: string) =>
  apiGet<string[]>(`/api/players/search/verified?q=${encodeURIComponent(q)}`);
```

- [ ] **Step 3b: Update `TokensPanel`**

In `apps/web/src/components/controls/tokens-panel.tsx`: add the imports at the top (after line 2), the `myGamertag` prop, and swap the two raw `<input>`s for `<GamertagAutocomplete>`.

Add imports:

```tsx
import { GamertagAutocomplete } from "./gamertag-autocomplete";
import { searchVerifiedGamertags } from "@/lib/api";
```

Add `myGamertag?: string;` to the props type and destructuring:

```tsx
export function TokensPanel({
  balance,
  send,
  referrer,
  onSend,
  onSetReferrer,
  showReferrer = true,
  boxed = false,
  myGamertag,
}: {
  balance: number;
  send: MutationView;
  referrer: MutationView;
  onSend: (gamertag: string) => void;
  onSetReferrer: (gamertag: string) => void;
  showReferrer?: boolean;
  boxed?: boolean;
  myGamertag?: string;
}) {
```

Replace the Send `<input>` (the block with `aria-label="Send a token to a verified player"`) with:

```tsx
        <GamertagAutocomplete
          aria-label="Send a token to a verified player"
          placeholder="SEND TO VERIFIED PLAYER…"
          value={to}
          onChange={setTo}
          fetchSuggestions={searchVerifiedGamertags}
          exclude={myGamertag}
          className="min-w-0 flex-1"
          inputClassName="w-full border border-dark-line bg-[#111] px-3 py-2 font-mono text-[11.5px] tracking-[.04em] text-paper outline-none placeholder:text-cream-muted focus:border-paper"
        />
```

Replace the Referrer `<input>` (the block with `aria-label="Referred by"`) with:

```tsx
            <GamertagAutocomplete
              aria-label="Referred by"
              placeholder="REFERRED BY…"
              value={ref}
              onChange={setRef}
              fetchSuggestions={searchVerifiedGamertags}
              exclude={myGamertag}
              className="min-w-0 flex-1"
              inputClassName="w-full border border-dark-line bg-[#111] px-3 py-2 font-mono text-[11.5px] tracking-[.04em] text-paper outline-none placeholder:text-cream-muted focus:border-paper"
            />
```

(The now-unused `darkInput` const on lines 6–7 can be deleted — it has no remaining references.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/web exec vitest run src/components/controls/tokens-panel.test.tsx`
Expected: PASS — the new exclude case plus all pre-existing cases (balance/footnote, trimmed submit, zero-balance disable, mapped error, `send.ok` clears input, referrer hide).

- [ ] **Step 5: Wire the containers to pass `myGamertag`**

In `apps/web/src/components/controls/rail.tsx`, the verified branch already binds `const gamertag = c.status.link.gamertag` (line ~98). Add the prop to its `<TokensPanel>`:

```tsx
        <TokensPanel
          balance={c.balance ?? 0}
          send={mutView(a.send)}
          referrer={mutView(a.refer)}
          onSend={(gt) => a.send.mutate(gt)}
          onSetReferrer={(gt) => a.refer.mutate(gt)}
          myGamertag={gamertag}
        />
```

In `apps/web/src/components/controls/mobile-controls.tsx`, `gamertag` is `string | null` (line ~39). Add the prop to its `<TokensPanel>` (which already sets `boxed`/`showReferrer={false}`):

```tsx
            <TokensPanel
              boxed
              showReferrer={false}
              balance={c.balance ?? 0}
              send={mutView(a.send)}
              referrer={mutView(a.refer)}
              onSend={(gt) => a.send.mutate(gt)}
              onSetReferrer={() => {}}
              myGamertag={gamertag ?? undefined}
            />
```

- [ ] **Step 6: Typecheck the web app**

Run: `pnpm --filter @onelife/web exec tsc --noEmit`
Expected: PASS — no type errors (confirms `myGamertag={gamertag}` in `rail.tsx` is `string` and `gamertag ?? undefined` in `mobile-controls.tsx` satisfies `myGamertag?: string`).

- [ ] **Step 7: Run the full controls test suite (regression sweep)**

Run: `pnpm --filter @onelife/web exec vitest run src/components/controls`
Expected: PASS — `gamertag-autocomplete`, `link-verify-panels`, `tokens-panel`, and the other controls tests all green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/components/controls/tokens-panel.tsx apps/web/src/components/controls/tokens-panel.test.tsx apps/web/src/components/controls/rail.tsx apps/web/src/components/controls/mobile-controls.tsx
git commit -m "feat(web): verified-player autocomplete on Send & Referrer fields"
```

---

## Finishing (after all tasks)

Not part of the TDD tasks — run via the `finishing-a-feature` skill before the PR:

- [ ] Full verification: `pnpm turbo run typecheck` and `pnpm turbo run test --concurrency=1` (the latter needs `TEST_DATABASE_URL`).
- [ ] Drive the change end-to-end (the `verify` skill) — type in Send/Referrer, confirm the dropdown lists verified players and never the signed-in user.
- [ ] Update `CHANGELOG.md` (required on every PR).
- [ ] Update `CLAUDE.md` **last** — extend the SP2 controls-rail paragraph to note the two fields autocomplete over verified players (excluding self) via the new `searchVerifiedGamertags` read-model + `GET /players/search/verified` route, and that `LinkTagPanel`/`TokensPanel` share `<GamertagAutocomplete>`.
- [ ] Open the PR into `develop`.

## Self-Review (completed during planning)

- **Spec coverage:** read-model → Task 1; route → Task 2; shared component (extraction, exclude, overlay) → Task 3; `LinkTagPanel` refactor → Task 4; web client + `TokensPanel` + wiring → Task 5; all four testing bullets covered (component test T3, DB read-model test T1, `tokens-panel.test.tsx` update T5, `link-verify-panels.test.tsx` regression T4); route test (beyond spec's list) → T2.
- **Placeholder scan:** none — every code step shows complete code; every run step shows the exact command + expected result.
- **Type consistency:** `searchVerifiedGamertags(db, prefix, limit)` (T1) is called with `(db, prefix, 10)` (T2) and exposed as `searchVerifiedGamertags(q)` on the web (T5); `GamertagAutocomplete` prop names (`value/onChange/fetchSuggestions/exclude/className/inputClassName/aria-label/id/placeholder`) are identical across T3 definition and T4/T5 consumers; `myGamertag?: string` (T5) receives `string` (rail) and `string | undefined` (mobile) consistently.
