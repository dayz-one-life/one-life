# Ticket Hero + Join the Servers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the pending hero as emote tickets (no live-tracker implication) and ship the universal yellow "Join the servers" block across cold/unlinked/pending homes, per `docs/superpowers/specs/2026-07-29-join-the-servers-design.md`.

**Architecture:** `PendingHeroView`'s live branch is rewritten around a `TicketSequence` (paper tickets + CONFIRMED stamp, no current-step pointer); a new `JoinServers` component (yellow slab: FitLine heading, three dashed paper step-tickets, a static console-browser replica, a `closing`-prop line) replaces `ConnectSection` everywhere; `PendingSupport` becomes Rules → JoinServers → Fallen.

**Tech Stack:** Next.js App Router (apps/web), React 19, Tailwind, vitest + RTL (jsdom). No API/DB/worker changes.

## Global Constraints

- **No current-step pointer on the emote sequence** — no `←`, no highlighted "next" state. Only server-confirmed state renders differently.
- New status-paragraph copy is VERBATIM and pinned: "DayZ reports emotes in batches — confirmations land up to 15 minutes behind, and this page does not update in real time. Perform all three and you can log off; the stamp catches up on its own." (preceded by the bold yellow "The server has confirmed N of M.")
- No copy may match `/instantly|immediately|watch (this|it) update|updates? live/i`.
- `red-deep` NEVER on dark surfaces; on the yellow/paper tickets it is the correct token for the small ordinals. Yellow stays the pending signature on the dark hero.
- The replica is an ILLUSTRATION with static example numbers (spec §4.3) — do not wire to live data. Host names `One Life <Map> | dayzonelife.com` are brand copy. No LB/RB chips, no controller-button glyphs.
- Ordinals come from `["First", "Second", "Third", "Fourth", "Fifth"][i] ?? `${i + 1}.``.
- Container discipline: objects full container width; prose `max-w-2xl`; JoinServers' closing line is the single centered exception (`max-w-3xl mx-auto text-center`).
- Web tests: `pnpm --filter @onelife/web test -- <pattern>` from the repo root. Branch: `feature/join-the-servers` (already created).
- The untracked `apps/web/src/app/(site)/(boxed)/design-preview/` harness must NOT be committed at any step; it is deleted in Task 4.

---

### Task 1: `JoinServers` component

**Files:**
- Create: `apps/web/src/components/front-page/join-servers.tsx`
- Test: `apps/web/src/components/front-page/join-servers.test.tsx`

**Interfaces:**
- Consumes: `FitLine` (`./fit-line`).
- Produces: `JoinServers({ closing?: string })` — default closing "Play first, claim later — your life is tracked from your first spawn." Task 3 mounts it in three surfaces; pending passes `closing="Any server counts for your emotes."`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/front-page/join-servers.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { JoinServers } from "./join-servers";

// FitLine observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

describe("JoinServers", () => {
  it("renders the section heading and the three step tickets with red-deep ordinals and dashed borders", () => {
    render(<JoinServers />);
    expect(screen.getByRole("heading", { level: 2, name: "Join the servers" })).toBeInTheDocument();
    const steps = screen.getByRole("list", { name: "How to join" });
    const items = within(steps).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toMatch(/First/);
    expect(items[0]!.textContent).toMatch(/Search “One Life”/);
    expect(items[1]!.textContent).toMatch(/Second/);
    expect(items[1]!.textContent).toMatch(/Pick your map/);
    expect(items[2]!.textContent).toMatch(/Third/);
    expect(items[2]!.textContent).toMatch(/★ Favorite them/);
    for (const item of items) {
      expect(item.className).toContain("border-dashed");
      expect(item.querySelector(".text-red-deep")).not.toBeNull();
    }
  });

  it("replica: host rows verbatim, A–Z, players column static, servers-found footer", () => {
    render(<JoinServers />);
    expect(screen.getByText(/One Life Chernarus \| dayzonelife\.com/)).toBeInTheDocument();
    expect(screen.getByText(/One Life Livonia \| dayzonelife\.com/)).toBeInTheDocument();
    expect(screen.getByText(/One Life Sakhal \| dayzonelife\.com/)).toBeInTheDocument();
    // Host A–Z: Chernarus before Livonia before Sakhal (DOM order).
    const chernarus = screen.getByText(/One Life Chernarus/);
    const livonia = screen.getByText(/One Life Livonia/);
    const sakhal = screen.getByText(/One Life Sakhal/);
    expect(chernarus.compareDocumentPosition(livonia) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(livonia.compareDocumentPosition(sakhal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Servers found: 3")).toBeInTheDocument();
    // The illustration caption is what frames the static numbers as honest.
    expect(screen.getByText(/What you.ll see on your screen/i)).toBeInTheDocument();
  });

  it("carries no controller chrome — no LB/RB chips, no button glyphs", () => {
    const { container } = render(<JoinServers />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bLB\b|\bRB\b|Ⓐ|Ⓧ|Ⓨ|Ⓑ/);
  });

  it("closing line defaults to the play-first promise and accepts an override", () => {
    const { rerender } = render(<JoinServers />);
    expect(
      screen.getByText("Play first, claim later — your life is tracked from your first spawn."),
    ).toBeInTheDocument();
    rerender(<JoinServers closing="Any server counts for your emotes." />);
    expect(screen.getByText("Any server counts for your emotes.")).toBeInTheDocument();
    expect(screen.queryByText(/Play first, claim later/)).not.toBeInTheDocument();
  });

  it("no copy claims live or instant updates", () => {
    const { container } = render(<JoinServers />);
    expect(container.textContent ?? "").not.toMatch(/instantly|immediately|watch (this|it) update|updates? live/i);
  });

  it("is the yellow slab and never uses red-deep on a dark child", () => {
    const { container } = render(<JoinServers />);
    const section = container.querySelector("section")!;
    expect(section.className).toContain("bg-yellow");
    // red-deep may only appear inside the paper tickets, never inside the dark replica.
    const replica = container.querySelector("[data-testid='browser-replica']")!;
    expect(replica.className).toContain("bg-dark");
    expect(replica.innerHTML).not.toContain("red-deep");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web test -- join-servers`
Expected: FAIL — cannot resolve `./join-servers`.

- [ ] **Step 3: Implement**

`apps/web/src/components/front-page/join-servers.tsx`:

```tsx
import { FitLine } from "./fit-line";

/**
 * The universal connect beat (join-the-servers spec §4): a full-bleed yellow slab — the only
 * yellow section on the site — with the three moves as dashed paper tickets and a stylized
 * replica of the Xbox server-browser screen. Mounted on the cold home, the unlinked pitch and
 * the pending home; `closing` is the ONLY per-surface variation.
 *
 * ⚠️ THE REPLICA IS AN ILLUSTRATION, NOT A DATA SURFACE (spec §4.3). The player counts are
 * static example numbers, and the caption ("What you'll see on your screen") is what makes
 * that honest — this is a picture of the game's own UI, like a screenshot in a manual. Do not
 * wire it to live data, and do not cite it as precedent for fabricated counts on any surface
 * that presents OUR data. The host names (`One Life <Map> | dayzonelife.com`) are BRAND COPY,
 * verified against a real console screenshot (2026-07-29) and maintained by hand like
 * HowToConnect's SEARCH_TERM — a Nitrado rename must update them here.
 */
const HOSTS = [
  // Host A–Z, the real browser's default sort. Add Badlands here when it ships.
  { map: "Chernarus", players: "14/26" },
  { map: "Livonia", players: "3/16" },
  { map: "Sakhal", players: "6/26" },
];

const STEPS = [
  { ordinal: "First", move: "Search “One Life”" },
  { ordinal: "Second", move: "Pick your map" },
  { ordinal: "Third", move: "★ Favorite them" },
];

function BrowserReplica() {
  return (
    <div data-testid="browser-replica" className="w-full border-[3px] border-ink bg-dark">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 font-mono text-[12px] uppercase tracking-[.08em]">
        <span className="text-cream-muted">Favorites</span>
        <span className="text-cream-muted">Official</span>
        <span className="bg-red px-2 py-0.5 font-bold text-white">Community</span>
      </div>
      <div className="mt-3 flex items-center gap-3 bg-red px-4 py-2.5">
        <span className="font-mono text-[12px] font-bold uppercase tracking-[.1em] text-white">
          Search by name
        </span>
        <span className="flex flex-1 items-center gap-1 border-2 border-white/80 bg-dark px-3 py-1.5">
          <span className="font-mono text-base font-bold uppercase tracking-[.06em] text-paper">One Life</span>
          <span aria-hidden="true" className="inline-block h-4 w-[8px] bg-paper motion-safe:animate-pulse" />
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-b border-dark-line px-4 py-2 font-mono text-[11px] uppercase tracking-[.1em] text-cream-muted">
        <span>Host</span>
        <span>Map</span>
        <span className="text-right">Players</span>
      </div>
      <ul>
        {HOSTS.map((h) => (
          <li
            key={h.map}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-dark-line px-4 py-2.5 font-mono text-[13px]"
          >
            <span className="min-w-0 truncate text-paper">
              <span aria-hidden="true" className="mr-2 text-yellow">★</span>
              One Life {h.map} | dayzonelife.com
            </span>
            <span className="text-cream-dim">{h.map}</span>
            <span className="text-right text-cream-dim">{h.players}</span>
          </li>
        ))}
      </ul>
      <div className="px-4 py-2 font-mono text-[11px] uppercase tracking-[.08em] text-cream-muted">
        Servers found: {HOSTS.length}
      </div>
    </div>
  );
}

export function JoinServers({
  closing = "Play first, claim later — your life is tracked from your first spawn.",
}: {
  /** The one per-surface variation (spec §4.4) — pending passes "Any server counts for your emotes." */
  closing?: string;
}) {
  return (
    <section aria-label="Join the servers" className="border-y-4 border-ink bg-yellow px-6 py-14 text-ink md:px-10">
      <h2 className="font-display font-bold uppercase leading-none">
        <FitLine finalText="Join the servers" lineClassName="text-[clamp(2.5rem,8vw,9rem)]">
          Join the servers
        </FitLine>
      </h2>
      <ol role="list" aria-label="How to join" className="mt-8 grid w-full grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.ordinal} className="border-2 border-dashed border-ink bg-paper px-5 py-6 text-center">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[.2em] text-red-deep">{s.ordinal}</p>
            <p className="mt-1.5 font-display text-2xl font-bold uppercase leading-[.95] text-ink md:text-3xl">
              {s.move}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-8 font-mono text-[11px] font-bold uppercase tracking-[.16em]">
        What you&rsquo;ll see on your screen
      </p>
      <div className="mt-2">
        <BrowserReplica />
      </div>
      <p className="mx-auto mt-10 max-w-3xl text-center font-display text-2xl font-bold uppercase leading-tight md:text-3xl">
        {closing}
      </p>
    </section>
  );
}
```

Note the curly quotes in `Search “One Life”` — the test matches them; keep the exact characters.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test -- join-servers`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page/join-servers.tsx apps/web/src/components/front-page/join-servers.test.tsx
git commit -m "feat(web): JoinServers — the universal yellow connect slab"
```

---

### Task 2: `PendingHeroView` — the ticket sequence

**Files:**
- Modify: `apps/web/src/components/front-page/pending-hero.tsx` (rewrite the live branch; keep the container, the expired branch, and the kicker)
- Test: `apps/web/src/components/front-page/pending-hero.test.tsx` (rewrite)

**Interfaces:**
- Consumes: unchanged — `Challenge`, `formatExpiry`, `SkewCta`, `SrStatus`, `FitLine`, `cn`; the `PendingHero` container is untouched.
- Produces: same `PendingHeroView(props)` signature (gamertag, challenge, now, onCancel, onReclaim, canceling?, reclaiming?). No consumer changes.

- [ ] **Step 1: Rewrite the test file**

Replace `apps/web/src/components/front-page/pending-hero.test.tsx` wholesale:

```tsx
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PendingHeroView } from "./pending-hero";
import type { Challenge } from "@/lib/types";

// FitLine observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

const NOW = new Date("2026-07-16T12:00:00Z").getTime();

const challenge = (over: Partial<Challenge>): Challenge => ({
  sequence: ["point at self", "clap", "thumbs down"], progressIndex: 1,
  expiresAt: "2026-07-17T10:10:00Z", expired: false, ...over,
});

const view = (over: Partial<Parameters<typeof PendingHeroView>[0]> = {}) => (
  <PendingHeroView
    gamertag="BootsColdwater"
    challenge={challenge({})}
    now={NOW}
    onCancel={() => {}}
    onReclaim={() => {}}
    {...over}
  />
);

describe("PendingHeroView — live challenge", () => {
  test("h1, kicker, and the deck sentence", () => {
    render(view());
    expect(
      screen.getByRole("heading", { level: 1, name: "Prove it's you BootsColdwater" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByText(/Join any One Life server and perform these three emotes/)).toBeInTheDocument();
  });

  test("three tickets with ordinals; confirmed ticket is stamped, unconfirmed are dashed", () => {
    render(view());
    const list = screen.getByRole("list", { name: "Emote sequence" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toMatch(/First/);
    expect(items[0]!.textContent).toMatch(/point at self/i);
    expect(items[0]!.textContent).toMatch(/Confirmed/);
    expect(items[0]!.className).toContain("bg-paper");
    expect(items[1]!.textContent).toMatch(/Second/);
    expect(items[1]!.className).toContain("border-dashed");
    expect(items[2]!.textContent).toMatch(/Third/);
    expect(items[2]!.className).toContain("border-dashed");
  });

  // ⚠️ THE HONESTY FIX (spec §2): the sequence must never render a live-tracker affordance.
  test("no current-step pointer exists — no arrow, no 'current' highlight", () => {
    const { container } = render(view());
    expect(container.textContent ?? "").not.toContain("←");
    expect(container.innerHTML).not.toContain("data-current");
  });

  test("ticket confirmation state reaches a screen reader in words", () => {
    render(view());
    expect(screen.getByText("— confirmed by the server")).toBeInTheDocument();
    expect(screen.getAllByText("— not yet confirmed")).toHaveLength(2);
  });

  test("progress announces via a role=status region separate from the list", () => {
    const { rerender } = render(view({ challenge: challenge({ progressIndex: 1 }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 3 confirmed");
    rerender(view({ challenge: challenge({ progressIndex: 2 }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 3 confirmed");
    expect(screen.getByRole("status").tagName).not.toBe("OL");
  });

  // The batching expectation, in the status paragraph — VERBATIM (spec §2). Without it a player
  // performing the sequence and watching nothing move concludes it is broken and cancels.
  test("status paragraph: confirmed count lead + verbatim batching copy", () => {
    render(view());
    expect(screen.getByText("The server has confirmed 1 of 3.")).toBeInTheDocument();
    expect(
      screen.getByText(
        /DayZ reports emotes in batches — confirmations land up to 15 minutes behind, and this page does not update in real time\. Perform all three and you can log off; the stamp catches up on its own\./,
      ),
    ).toBeInTheDocument();
  });

  test("no copy claims live or instant updates", () => {
    const { container } = render(view());
    expect(container.textContent ?? "").not.toMatch(/instantly|immediately|watch (this|it) update|updates? live/i);
  });

  test("the old walkthrough list is gone — only the emote list remains", () => {
    render(view());
    expect(screen.queryByRole("list", { name: "How this works" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  test("footer: expiry countdown and a 44pt cancel that fires", () => {
    const onCancel = vi.fn();
    render(view({ onCancel }));
    expect(screen.getByText(/expires in 22h/i)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Cancel claim" });
    expect(btn.className).toContain("min-h-[44px]");
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalled();
  });

  test("red-deep never appears on the dark hero", () => {
    const { container } = render(view());
    expect(container.innerHTML).not.toContain("red-deep");
  });
});

describe("PendingHeroView — expired", () => {
  test("same frame, kicker still renders, reclaim CTA replaces the tickets", () => {
    const onReclaim = vi.fn();
    const { container } = render(view({ challenge: challenge({ expired: true }), onReclaim }));
    expect(container.querySelector("section")!.className).toContain("bg-dark");
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Your verification for BootsColdwater expired" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a new challenge →" }));
    expect(onReclaim).toHaveBeenCalled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("a null challenge renders the expired state", () => {
    render(view({ challenge: null }));
    expect(screen.getByRole("button", { name: "Start a new challenge →" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm --filter @onelife/web test -- pending-hero`
Expected: FAIL (tickets, ordinals, status paragraph, deck all missing; several old-markup tests gone).

- [ ] **Step 3: Rewrite the live branch of `PendingHeroView`**

In `apps/web/src/components/front-page/pending-hero.tsx`: keep the file's imports, `quietBtn`, the component signatures, the doc comments (update the top comment's description of the body), the kicker (both branches — its deliberate-in-expired comment stays), and the expired branch. Add above `PendingHeroView`:

```tsx
const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth"];

/** The sequence as paper tickets (spec §2): orders to carry out, not a live tracker. Only
 *  server-confirmed state renders differently — NO current-step pointer, ever. */
function TicketSequence({ challenge: c }: { challenge: Challenge }) {
  return (
    <ol
      role="list"
      aria-label="Emote sequence"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4"
    >
      {c.sequence.map((emote, i) => {
        const confirmed = i < c.progressIndex;
        return (
          <li
            key={i}
            className={cn(
              "relative flex min-h-[130px] flex-col items-center justify-center gap-1 px-4 py-8 text-center md:min-h-[170px]",
              confirmed ? "bg-paper text-ink" : "border-2 border-dashed border-dark-line text-paper",
            )}
          >
            <span
              className={cn(
                "font-mono text-[12px] font-bold uppercase tracking-[.2em]",
                confirmed ? "text-ink-muted/60" : "text-yellow",
              )}
            >
              {ORDINALS[i] ?? `${i + 1}.`}
            </span>
            <span className={cn("font-display text-3xl font-bold uppercase leading-none md:text-5xl", confirmed && "opacity-30")}>
              {emote}
            </span>
            {confirmed && (
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="-rotate-[8deg] border-4 border-red bg-paper/70 px-3 py-0.5 font-display text-2xl font-bold uppercase tracking-[.08em] text-red">
                  Confirmed
                </span>
              </span>
            )}
            <span className="sr-only">{confirmed ? "— confirmed by the server" : "— not yet confirmed"}</span>
          </li>
        );
      })}
    </ol>
  );
}
```

Then replace the live (non-expired) branch's JSX below the `<h1>` (the h1 with FitLine + yellow gamertag is unchanged) with:

```tsx
          <p className="mt-6 max-w-2xl font-sans text-lg leading-relaxed text-cream-dim">
            Join any One Life server and perform these three emotes, in order. Other emotes in
            between don&rsquo;t matter — the order does.
          </p>
          {/* Separate node from the <ol> below — role="status" on the list itself would strip
           *  its list semantics (SR-structure spec). */}
          <SrStatus>{`Step ${challenge.progressIndex} of ${challenge.sequence.length} confirmed`}</SrStatus>
          <div className="mt-6">
            <TicketSequence challenge={challenge} />
          </div>
          <p className="mt-6 max-w-2xl border-l-4 border-yellow pl-4 font-sans text-base leading-relaxed text-cream-dim">
            <span className="font-bold text-yellow">
              {`The server has confirmed ${challenge.progressIndex} of ${challenge.sequence.length}.`}
            </span>{" "}
            DayZ reports emotes in batches — confirmations land up to 15 minutes behind, and this
            page does not update in real time. Perform all three and you can log off; the stamp
            catches up on its own.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6 font-mono text-[12px] uppercase tracking-[.06em]">
            <span className="font-bold text-yellow">{formatExpiry(challenge.expiresAt, now)}</span>
            <button type="button" onClick={onCancel} disabled={canceling} className={quietBtn}>
              Cancel claim
            </button>
          </div>
```

Delete from the old live branch: the "Perform, in order —" line, the old chip `<ol>`, the "How this works" walkthrough `<ol>`, the old batching+footnote paragraphs, and the standalone cancel div. Nothing in the expired branch changes. Update `quietBtn` only if it still carries `xl:min-h-0 xl:text-[10.5px]` (it should already be the plain 44px version from v0.61.0 — leave as found if so).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @onelife/web test -- pending-hero`
Expected: PASS. Then `pnpm --filter @onelife/web test -- account-panels-pending` (it asserts no "Prove it's you" text inside AccountPanels — untouched by this task, must still pass).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page/pending-hero.tsx apps/web/src/components/front-page/pending-hero.test.tsx
git commit -m "feat(web): pending hero — emote tickets, no live-tracker affordance"
```

---

### Task 3: Mount everywhere; retire `ConnectSection`

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (cold branch + `PendingSupport` props)
- Modify: `apps/web/src/app/(site)/(boxed)/page.test.tsx`
- Modify: `apps/web/src/components/front-page/unverified-pitch.tsx` + `unverified-pitch.test.tsx`
- Modify: `apps/web/src/components/front-page/pending-support.tsx` + `pending-support.test.tsx`
- Delete: `apps/web/src/components/front-page/connect-section.tsx`, `connect-section.test.tsx`

**Interfaces:**
- Consumes: `JoinServers({ closing? })` from Task 1; `Rules`, `Fallen` (existing).
- Produces: `PendingSupport({ obits })` — the `servers` prop is REMOVED (the block is static).

- [ ] **Step 1: Update the flow tests first**

`pending-support.test.tsx` — replace wholesale:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PendingSupport } from "./pending-support";
import type { ObituaryCard } from "@/lib/types";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

const obit: ObituaryCard = {
  slug: "x-dies", headline: "X Dies", lede: "He did.", gamertag: "X",
  map: "chernarusplus", timeAliveSeconds: 3600,
} as ObituaryCard;

describe("PendingSupport", () => {
  it("pending: Rules → Join the servers → obituary wall, in that order", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<PendingSupport obits={[obit]} />);
    const rules = screen.getByText("Death is real");
    const join = screen.getByRole("heading", { level: 2, name: "Join the servers" });
    const fallen = screen.getByRole("region", { name: "Recent obituaries" });
    expect(rules.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(join.compareDocumentPosition(fallen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pending: the closing line is the emote variant, not the cold promise", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<PendingSupport obits={[obit]} />);
    expect(screen.getByText("Any server counts for your emotes.")).toBeInTheDocument();
    expect(screen.queryByText(/Play first, claim later/)).not.toBeInTheDocument();
  });

  it.each(["loading", "signedOut", "unlinked", "verified"] as const)(
    "renders NOTHING for %s — no flash, no duplicate landmarks",
    (kind) => {
      mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
      const { container } = render(<PendingSupport obits={[obit]} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
```

`unverified-pitch.test.tsx` — replace the "does NOT render ConnectSection's copy" test (its dedup concern is gone: `JoinServers` carries no "How to connect" landmark, so mounting it beside the ladder's `HowToConnect` card is legal; the phrase it banned now legitimately returns via the closing line) with:

```tsx
  it("unlinked: Join the servers renders AFTER the CTA slab, and no 'How to connect' landmark ships from here", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<UnverifiedPitch {...props} />);
    const cta = screen.getByRole("heading", { name: /Claim it/i });
    const join = screen.getByRole("heading", { level: 2, name: "Join the servers" });
    expect(cta.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The claim ladder's empty state (AccountPanels, separate mount) owns the ONLY
    // "How to connect" landmark on the unlinked page — this component must not add one.
    expect(screen.queryByRole("region", { name: "How to connect" })).not.toBeInTheDocument();
  });
```

`page.test.tsx` — in the "signed out: the connect section follows the CTA slab…" test, the assertion text still works (the closing line contains "Play first, claim later"), but rename the test's description to reference Join the servers and add, after the existing DOM-order assertion:

```tsx
    expect(screen.getByRole("heading", { level: 2, name: "Join the servers" })).toBeInTheDocument();
```

(Keep the `#claim`-absent assertion. Note: the test file already stubs ResizeObserver.)

- [ ] **Step 2: Run to verify the flow tests fail**

Run: `pnpm --filter @onelife/web test -- "pending-support|unverified-pitch|app"`
Expected: new/changed tests FAIL (JoinServers not mounted anywhere; PendingSupport still takes `servers`).

- [ ] **Step 3: Rewire the three surfaces**

`pending-support.tsx` — replace wholesale:

```tsx
"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { ObituaryCard } from "@/lib/types";
import { Rules } from "./rules";
import { JoinServers } from "./join-servers";
import { Fallen } from "./fallen";

/**
 * Support content for a PENDING player, below the #claim hero (join-the-servers spec §3):
 * Rules → JoinServers → Fallen, mirroring the cold home's beat rhythm. The closing line is the
 * emote variant — "claim later" is a done step for a pending player.
 *
 * Renders NOTHING for every other status, including `loading` (no flash).
 */
export function PendingSupport({ obits }: { obits: ObituaryCard[] }) {
  const status = useAccountStatus();
  if (status.kind !== "pending") return null;
  return (
    <>
      <Rules />
      <JoinServers closing="Any server counts for your emotes." />
      <Fallen rows={obits} />
    </>
  );
}
```

`unverified-pitch.tsx` — add `import { JoinServers } from "./join-servers";` and append `<JoinServers />` after `<CtaSlab audience="unverified" />` inside the fragment.

`page.tsx` — swap the import `ConnectSection` → `JoinServers`; in the cold branch replace `<ConnectSection servers={serversView(servers.data, { failed: servers.failed })} />` with `<JoinServers />`; change the `PendingSupport` mount to `<PendingSupport obits={obits.data?.rows ?? []} />`. If `serversView` is now unused in the file, drop it from the import (the `servers` fetch itself stays — the signed-in board resolution uses it).

Delete the retired component:

```bash
git rm apps/web/src/components/front-page/connect-section.tsx apps/web/src/components/front-page/connect-section.test.tsx
```

Then confirm nothing references it: `grep -rn "ConnectSection\|connect-section" apps/web/src` must return nothing (the design-preview harness is untracked — if it hits, that's Task 4's deletion, not a blocker; exclude it mentally but do NOT commit it).

- [ ] **Step 4: Run the full web suite + typecheck**

Run: `pnpm --filter @onelife/web test` then `pnpm turbo run typecheck`
Expected: PASS. Likely stragglers: any test still importing `connect-section`, and `front-page.test.tsx`/`three-modes.test.tsx` if they referenced retired copy — fix by removing the stale references, never by resurrecting the component.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): Join the servers everywhere — cold, unlinked, pending; retire ConnectSection"
```

(Verify with `git status` that `design-preview/` is NOT in the commit — it is untracked and must stay so.)

---

### Task 4: Verification, changelog, harness cleanup

**Files:**
- Modify: `CHANGELOG.md` (Unreleased)
- Delete (untracked): `apps/web/src/app/(site)/(boxed)/design-preview/`

- [ ] **Step 1: Delete the preview harness and stop nothing else**

```bash
rm -rf "apps/web/src/app/(site)/(boxed)/design-preview"
```

- [ ] **Step 2: Full check + guard greps**

Run: `pnpm turbo run typecheck` and `pnpm --filter @onelife/web test` — both PASS.

```bash
grep -rn "ConnectSection\|connect-section" apps/web/src && echo LEFTOVERS || echo clean
grep -rn "←" apps/web/src/components/front-page/pending-hero.tsx && echo POINTER || echo clean
grep -rn "text-red-deep" apps/web/src/components/front-page/pending-hero.tsx && echo VIOLATION || echo clean
```
Expected: `clean` three times.

- [ ] **Step 3: Changelog entry**

Under `## [Unreleased]` in CHANGELOG.md (create `### Changed` if absent, matching house format):

```markdown
- **The pending challenge is now emote tickets, and every home ends on "Join the servers."**
  The verification hero shows your three emotes as numbered paper tickets — a confirmed emote
  gets a red CONFIRMED stamp; nothing pretends to track you live (confirmations arrive in
  batches, and the page says so plainly). Below it, and closing the signed-out and unlinked
  homes too, a new full-bleed yellow "Join the servers" section shows the three moves and a
  picture of the exact Xbox server-browser screen you'll see. Browser check outstanding: the
  yellow slab and tickets at phone width; the replica table at 320px.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for ticket hero + Join the Servers"
```

Then hand off to `keel:finish-work`.
