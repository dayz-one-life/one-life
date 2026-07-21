# Prose Linkification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gamertag named inside an article's prose renders as a link to that player's dossier, across all four article interiors and the entire existing corpus.

**Architecture:** One pure render-time function, `linkifyGamertags(text, roster)`, returning `ReactNode[]`. Stored prose is never modified, so the feature is retroactive and needs no migration or backfill. Each interior supplies a **per-article** roster built from fields already on its DTO — never a global player roster, whose failure mode is a link on a word that is not a person.

**Tech Stack:** Next.js App Router (React server components), TypeScript, Vitest + React Testing Library, Tailwind with the project's Paper/Ink/Red tokens.

Spec: `docs/superpowers/specs/2026-07-21-prose-linkification-design.md`

## Global Constraints

- **Prose in the database is never modified.** All linking is render-time.
- **No `dangerouslySetInnerHTML`.** The function returns `ReactNode[]`, never an HTML string.
- **The matched text is rendered, never the roster's casing.** If the prose says `hartman`, the page says `hartman`.
- **No regex lookbehind** (`(?<!...)`). Safari below 16.4 throws a *syntax error at construction*, which would crash every article page. Boundaries are checked by inspecting the characters either side of the match.
- **Roster is per-article only.** Never query the global player list to build one.
- **An empty or absent roster must render byte-identical DOM to today.** This is the regression guard for all 168 legacy articles.
- **`red-deep` is the in-prose link token.** Article interiors are light paper surfaces; plain `red` is display-only at this size, and `red-deep` must never be used on a dark surface (see the RED POLICY comment in `globals.css`).
- Run web tests with `pnpm --filter @onelife/web run test`; newsdesk tests with `pnpm --filter @onelife/newsdesk run test`.
- Full suite is `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1 --env-mode=loose` — turbo v2 strips undeclared env vars, and this machine's Postgres is on 5434.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/web/src/lib/linkify-gamertags.tsx` (create) | The pure matcher. Text + roster → `ReactNode[]`. |
| `apps/web/src/lib/article-roster.ts` (create) | Per-kind roster builders. DTO → `string[]`. |
| `apps/web/src/components/shared/pull-quote.tsx` (modify) | Widen `text` to `ReactNode` so a quote block can contain links. |
| `apps/web/src/components/shared/article-body.tsx` (modify) | Accept `roster`, apply to para/quote/list **and the flat fallback**. |
| `apps/web/src/components/obituaries/obituary-article.tsx` (modify) | Roster + linkified lede. |
| `apps/web/src/components/birth-notices/birth-notice-article.tsx` (modify) | Roster (no lede is rendered here). |
| `apps/web/src/components/news/news-article.tsx` (modify) | Roster + linkified lede. |
| `apps/web/src/components/news/editorial-article.tsx` (modify) | Roster + linkified lede. |
| `apps/newsdesk/src/newsroom/store.ts` (modify) | Validate the editorial roster against real players at publish time. |

**Discovery that shrinks spec §6:** the `newsroom` contract *already* has a `subjects: [{gamertag, mapSlug?, lifeNumber?}]` array (`contract.ts:26-30`) and `store.ts:34` already writes it into `facts.subjects`. Editorial rosters therefore need no new CLI field — only the publish-time existence check in Task 8.

---

### Task 1: The pure matcher

**Files:**
- Create: `apps/web/src/lib/linkify-gamertags.tsx`
- Test: `apps/web/src/lib/linkify-gamertags.test.tsx`

**Interfaces:**
- Consumes: `GamertagLink` from `@/components/shared/gamertag-link` (existing, takes `{gamertag, className?}` and renders the gamertag text linked to `/players/{playerSlug(gamertag)}`).
- Produces: `linkifyGamertags(text: string, roster: string[]): ReactNode[]` and the exported constant `PROSE_LINK_CLASS: string`.

**Note on casing:** the matched text is passed as `GamertagLink`'s `gamertag` prop. Matching is case-insensitive *only*, so the matched text and the roster entry differ at most in case, and `playerSlug` lowercases — the href is identical either way. No change to `GamertagLink` is needed.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/lib/linkify-gamertags.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { linkifyGamertags } from "./linkify-gamertags";

const view = (text: string, roster: string[]) => render(<p>{linkifyGamertags(text, roster)}</p>);

describe("linkifyGamertags", () => {
  it("links a gamertag that appears in the prose", () => {
    view("Then Hartman went quiet.", ["Hartman"]);
    expect(screen.getByRole("link", { name: "Hartman" })).toHaveAttribute("href", "/players/hartman");
  });

  it("returns the text untouched when the roster is empty", () => {
    const { container } = view("Then Hartman went quiet.", []);
    expect(container.textContent).toBe("Then Hartman went quiet.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("matches case-insensitively but renders the prose's own casing", () => {
    view("they called him hartman.", ["Hartman"]);
    const link = screen.getByRole("link", { name: "hartman" });
    expect(link).toHaveAttribute("href", "/players/hartman");
  });

  it("never matches inside a longer word", () => {
    view("A hunter shot Hunter.", ["Hunter"]);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
  });

  it("does not match a gamertag glued to trailing word characters", () => {
    const { container } = view("Hartman2 is someone else.", ["Hartman"]);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("links every occurrence, not just the first", () => {
    view("Hartman fired. Hartman missed. Hartman ran.", ["Hartman"]);
    expect(screen.getAllByRole("link", { name: "Hartman" })).toHaveLength(3);
  });

  it("prefers the longest match so a short name cannot shadow a longer one", () => {
    view("Big Bear was there.", ["Bear", "Big Bear"]);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Big Bear");
    expect(links[0]).toHaveAttribute("href", "/players/big-bear");
  });

  it("treats regex metacharacters in a gamertag literally", () => {
    view("watch out for A.C (x) tonight", ["A.C (x)"]);
    expect(screen.getByRole("link", { name: "A.C (x)" })).toBeInTheDocument();
    const { container } = render(<p>{linkifyGamertags("AXC (x) is fine", ["A.C (x)"])}</p>);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("links a multi-word gamertag", () => {
    view("xSgt Hartman took the ridge.", ["xSgt Hartman"]);
    expect(screen.getByRole("link", { name: "xSgt Hartman" })).toHaveAttribute("href", "/players/xsgt-hartman");
  });

  it("preserves the surrounding prose exactly", () => {
    const { container } = view("Then Hartman went quiet.", ["Hartman"]);
    expect(container.textContent).toBe("Then Hartman went quiet.");
  });

  it("ignores null and empty roster entries", () => {
    const { container } = render(<p>{linkifyGamertags("nothing here", ["", "  "])}</p>);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- src/lib/linkify-gamertags.test.tsx`
Expected: FAIL — `Failed to resolve import "./linkify-gamertags"`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/web/src/lib/linkify-gamertags.tsx
import type { ReactNode } from "react";
import { GamertagLink } from "@/components/shared/gamertag-link";

/** In-prose links need a non-hover affordance — colour alone fails WCAG 1.4.1. `red-deep` is the
 *  light-surface red; every article interior is paper, and it must never be used on a dark one. */
export const PROSE_LINK_CLASS = "text-red-deep underline decoration-dotted underline-offset-2";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `\w` is [A-Za-z0-9_]. A gamertag glued to one of these is a different token. */
const isWordChar = (c: string | undefined) => c !== undefined && /\w/.test(c);

/**
 * Splits prose into plain strings and `/players/{slug}` links for the gamertags in `roster`.
 *
 * The roster is always the ARTICLE'S OWN subjects — never the global player list, whose failure
 * mode is a link on a word that is not a person.
 *
 * Boundaries are checked by inspecting the characters either side of the match rather than with
 * a lookbehind: Safari below 16.4 throws a syntax error when a lookbehind regex is CONSTRUCTED,
 * which would crash every article page rather than degrade.
 */
export function linkifyGamertags(text: string, roster: string[]): ReactNode[] {
  const seen = new Set<string>();
  const names = roster
    .filter((n) => typeof n === "string" && n.trim().length > 0)
    .filter((n) => {
      const key = n.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    // Longest first: JS alternation is leftmost-FIRST, not leftmost-longest, so a short gamertag
    // listed earlier would otherwise shadow a longer one that contains it.
    .sort((a, b) => b.length - a.length);

  if (!text || names.length === 0) return [text];

  const re = new RegExp(names.map(escapeRe).join("|"), "gi");
  const out: ReactNode[] = [];
  let last = 0;

  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <GamertagLink key={`${start}-${m[0]}`} gamertag={m[0]} className={PROSE_LINK_CLASS} />,
    );
    last = end;
  }

  if (last === 0) return [text];
  if (last < text.length) out.push(text.slice(last));
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/web run test -- src/lib/linkify-gamertags.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/linkify-gamertags.tsx apps/web/src/lib/linkify-gamertags.test.tsx
git commit -m "feat(web): linkifyGamertags — pure per-article prose matcher"
```

---

### Task 2: `PullQuote` accepts rich text

**Files:**
- Modify: `apps/web/src/components/shared/pull-quote.tsx`
- Test: `apps/web/src/components/shared/pull-quote.test.tsx` (create if absent)

**Interfaces:**
- Produces: `PullQuote({ text: ReactNode, attribution: string })` — `string` remains valid, since a string is a `ReactNode`. Every existing caller compiles unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/shared/pull-quote.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PullQuote } from "./pull-quote";

describe("PullQuote", () => {
  it("renders plain string text", () => {
    render(<PullQuote text="He never made the treeline." attribution="a voice on the coast" />);
    expect(screen.getByText(/never made the treeline/)).toBeInTheDocument();
  });

  it("renders rich nodes so a quote can contain a link", () => {
    render(<PullQuote text={<a href="/players/hartman">Hartman</a>} attribution="a bystander" />);
    expect(screen.getByRole("link", { name: "Hartman" })).toHaveAttribute("href", "/players/hartman");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- src/components/shared/pull-quote.test.tsx`
Expected: FAIL — TypeScript rejects a `ReactNode` for the `text: string` prop.

- [ ] **Step 3: Widen the prop**

```tsx
// apps/web/src/components/shared/pull-quote.tsx
import type { ReactNode } from "react";

/** In-voice pull quote — attribution stays anonymous per the voice rules. `text` is a ReactNode,
 *  not a string, so a quote block's prose can carry linkified gamertags. */
export function PullQuote({ text, attribution }: { text: ReactNode; attribution: string }) {
  return (
    <blockquote className="my-6 border-l-[3px] border-red pl-5">
      <p className="font-display text-2xl font-bold uppercase leading-tight text-ink md:text-3xl">“{text}”</p>
      <footer className="mt-2 font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">— {attribution}</footer>
    </blockquote>
  );
}
```

- [ ] **Step 4: Run the test and the typechecker**

Run: `pnpm --filter @onelife/web run test -- src/components/shared/pull-quote.test.tsx`
Expected: PASS, 2 tests.
Run: `pnpm --filter @onelife/web run typecheck`
Expected: exit 0 — no existing caller breaks.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shared/pull-quote.tsx apps/web/src/components/shared/pull-quote.test.tsx
git commit -m "refactor(web): PullQuote text accepts ReactNode"
```

---

### Task 3: Per-kind roster builders

**Files:**
- Create: `apps/web/src/lib/article-roster.ts`
- Test: `apps/web/src/lib/article-roster.test.ts`

**Interfaces:**
- Consumes: DTO types from `@/lib/types` — `ObituaryArticle` (`gamertag: string`, `killerGamertag: string | null`), `BirthNoticeArticle` (`gamertag: string`), `NewsArticleDetail` (`gamertag: string | null`, `subjects: NewsSubjectRef[]`).
- Produces: `obituaryRoster(a)`, `birthNoticeRoster(a)`, `newsRoster(a)` — all `(article) => string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/article-roster.test.ts
import { describe, it, expect } from "vitest";
import { obituaryRoster, birthNoticeRoster, newsRoster } from "./article-roster";

describe("obituaryRoster", () => {
  it("includes the subject and the killer", () => {
    expect(obituaryRoster({ gamertag: "Hartman", killerGamertag: "Pyle" })).toEqual(["Hartman", "Pyle"]);
  });
  it("drops a null killer", () => {
    expect(obituaryRoster({ gamertag: "Hartman", killerGamertag: null })).toEqual(["Hartman"]);
  });
  it("dedupes case-insensitively when a player killed themselves", () => {
    expect(obituaryRoster({ gamertag: "Hartman", killerGamertag: "hartman" })).toEqual(["Hartman"]);
  });
});

describe("birthNoticeRoster", () => {
  it("is just the subject", () => {
    expect(birthNoticeRoster({ gamertag: "Pyle" })).toEqual(["Pyle"]);
  });
});

describe("newsRoster", () => {
  it("includes the article gamertag and every listed subject", () => {
    const roster = newsRoster({
      gamertag: "Hartman",
      subjects: [
        { gamertag: "Pyle", mapSlug: "sakhal", lifeNumber: 3 },
        { gamertag: "Cowboy", mapSlug: null, lifeNumber: 1 },
      ],
    });
    expect(roster).toEqual(["Hartman", "Pyle", "Cowboy"]);
  });
  it("handles an editorial piece with a null gamertag", () => {
    expect(newsRoster({ gamertag: null, subjects: [{ gamertag: "Pyle", mapSlug: null, lifeNumber: 1 }] })).toEqual(["Pyle"]);
  });
  it("returns an empty roster when nothing is named", () => {
    expect(newsRoster({ gamertag: null, subjects: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- src/lib/article-roster.test.ts`
Expected: FAIL — `Failed to resolve import "./article-roster"`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/lib/article-roster.ts

/**
 * The gamertags an article is allowed to linkify — always ITS OWN subjects, drawn from fields
 * already on the DTO. There is no `article_subjects` table (PR-2 research killed it) and there is
 * deliberately no global-roster fallback: matching frozen prose against every gamertag on the
 * server produces false positives on short or common names.
 */
function clean(names: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (typeof n !== "string") continue;
    const trimmed = n.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function obituaryRoster(a: { gamertag: string; killerGamertag: string | null }): string[] {
  return clean([a.gamertag, a.killerGamertag]);
}

export function birthNoticeRoster(a: { gamertag: string }): string[] {
  return clean([a.gamertag]);
}

export function newsRoster(a: {
  gamertag: string | null;
  subjects: { gamertag: string }[];
}): string[] {
  return clean([a.gamertag, ...a.subjects.map((s) => s.gamertag)]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/web run test -- src/lib/article-roster.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/article-roster.ts apps/web/src/lib/article-roster.test.ts
git commit -m "feat(web): per-article roster builders for prose linkification"
```

---

### Task 4: `ArticleBody` applies the roster

**Files:**
- Modify: `apps/web/src/components/shared/article-body.tsx`
- Test: `apps/web/src/components/shared/article-body.test.tsx` (create if absent; if it exists, append the new `describe`)

**Interfaces:**
- Consumes: `linkifyGamertags` (Task 1), `PullQuote` with a `ReactNode` text (Task 2).
- Produces: `ArticleBody({ blocks, fallback, className, roster })` where `roster?: string[]` defaults to `[]`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/shared/article-body.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ArticleBody } from "./article-body";

describe("ArticleBody linkification", () => {
  it("links a gamertag in a para block", () => {
    render(<ArticleBody blocks={[{ type: "para", text: "Hartman went north." }]} fallback="" roster={["Hartman"]} />);
    expect(screen.getByRole("link", { name: "Hartman" })).toHaveAttribute("href", "/players/hartman");
  });

  it("links a gamertag in a quote block", () => {
    render(
      <ArticleBody
        blocks={[{ type: "quote", text: "Hartman never came back.", attribution: "a bystander" }]}
        fallback=""
        roster={["Hartman"]}
      />,
    );
    expect(screen.getByRole("link", { name: "Hartman" })).toBeInTheDocument();
  });

  it("links a gamertag in a list item", () => {
    render(<ArticleBody blocks={[{ type: "list", items: ["Hartman, twice"] }]} fallback="" roster={["Hartman"]} />);
    expect(screen.getByRole("link", { name: "Hartman" })).toBeInTheDocument();
  });

  it("links a gamertag in the flat fallback path — the whole pre-0014 corpus", () => {
    render(<ArticleBody blocks={null} fallback={"Hartman went north.\n\nThen he did not."} roster={["Hartman"]} />);
    expect(screen.getByRole("link", { name: "Hartman" })).toBeInTheDocument();
  });

  it("does not link a subhead", () => {
    render(<ArticleBody blocks={[{ type: "subhead", text: "Hartman" }]} fallback="" roster={["Hartman"]} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders identical markup to an unlinked body when no roster is passed", () => {
    const blocks = [{ type: "para" as const, text: "Hartman went north." }];
    const without = render(<ArticleBody blocks={blocks} fallback="" />).container.innerHTML;
    const empty = render(<ArticleBody blocks={blocks} fallback="" roster={[]} />).container.innerHTML;
    expect(empty).toBe(without);
    expect(without).not.toContain("<a");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- src/components/shared/article-body.test.tsx`
Expected: FAIL — `roster` is not a known prop, and no links are rendered.

- [ ] **Step 3: Implement**

Replace the body of `apps/web/src/components/shared/article-body.tsx` with:

```tsx
import { PullQuote } from "@/components/shared/pull-quote";
import { linkifyGamertags } from "@/lib/linkify-gamertags";
import type { ArticleBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Shared article body. `blocks` is the R5d rich body; when it is null/absent (every article
 *  written before R5d) — or, since `blocks` arrives as unchecked jsonb, anything else that isn't a
 *  usable array — it falls back to splitting the flat `body` on blank lines — byte-identical
 *  output to the two hand-rolled renderers this replaced. An unrecognised block type is dropped
 *  (`default: return null`) so a newer writer can ship a new kind without breaking an older page.
 *
 *  `roster` is the article's OWN subjects; any gamertag in it that appears in the prose becomes a
 *  link to that player's dossier. Omitted or empty, the rendered DOM is unchanged — which is the
 *  regression guard for the whole pre-linkification corpus. Subheads are deliberately excluded:
 *  they are display type, and an inline red link inside one fights the tabloid look. */
export function ArticleBody({
  blocks,
  fallback,
  className,
  roster = [],
}: {
  blocks?: ArticleBlock[] | null;
  fallback: string;
  className?: string;
  roster?: string[];
}) {
  const wrapper = cn("max-w-[68ch] space-y-4 font-mono text-base leading-relaxed text-ink-soft", className);
  const link = (text: string) => linkifyGamertags(text, roster);

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return (
      <div className={wrapper}>
        {fallback.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{link(para)}</p>
        ))}
      </div>
    );
  }

  return (
    <div className={wrapper}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "para":
            return <p key={i}>{link(block.text)}</p>;
          case "subhead":
            return (
              <h2 key={i} className="pt-2 font-display text-2xl font-bold uppercase leading-tight text-ink">
                {block.text}
              </h2>
            );
          case "quote":
            return <PullQuote key={i} text={link(block.text)} attribution={block.attribution} />;
          case "list":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{link(item)}</li>
                ))}
              </ul>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/web run test -- src/components/shared/article-body.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole web suite for regressions**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS — no existing article test changes, because every current caller omits `roster`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/shared/article-body.tsx apps/web/src/components/shared/article-body.test.tsx
git commit -m "feat(web): ArticleBody linkifies its article's own roster"
```

---

### Task 5: The obituary interior

**Files:**
- Modify: `apps/web/src/components/obituaries/obituary-article.tsx` (lede at line 44, `ArticleBody` at line 52)
- Test: `apps/web/src/components/obituaries/obituary-article.test.tsx` (append)

**Interfaces:**
- Consumes: `obituaryRoster` (Task 3), `linkifyGamertags` (Task 1), `ArticleBody`'s `roster` prop (Task 4).

- [ ] **Step 1: Write the failing test**

Append to the existing test file (reuse whatever article fixture builder it already defines; if it builds an article inline, copy that shape and set `gamertag`/`killerGamertag`/`lede`/`body` as below):

```tsx
describe("obituary prose linkification", () => {
  it("links the subject in the lede and the killer in the body", () => {
    render(
      <ObituaryArticleView
        article={{
          ...baseArticle,
          gamertag: "Hartman",
          killerGamertag: "Pyle",
          lede: "Hartman is dead.",
          body: "Pyle was waiting on the ridge.",
          bodyBlocks: null,
        }}
        more={[]}
      />,
    );
    expect(screen.getByRole("link", { name: "Hartman" })).toHaveAttribute("href", "/players/hartman");
    expect(screen.getByRole("link", { name: "Pyle" })).toHaveAttribute("href", "/players/pyle");
  });

  it("does not link the headline", () => {
    const { container } = render(
      <ObituaryArticleView
        article={{ ...baseArticle, gamertag: "Hartman", killerGamertag: null, headline: "Hartman Falls", lede: "", body: "", bodyBlocks: null }}
        more={[]}
      />,
    );
    expect(container.querySelector("h1 a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- src/components/obituaries/obituary-article.test.tsx`
Expected: FAIL — no links rendered.

- [ ] **Step 3: Implement**

Add the imports:

```tsx
import { obituaryRoster } from "@/lib/article-roster";
import { linkifyGamertags } from "@/lib/linkify-gamertags";
```

Inside the component, above the returned JSX:

```tsx
const roster = obituaryRoster(article);
```

Change the lede (line 44) to:

```tsx
<p className="mt-6 font-mono text-[15px] font-bold leading-relaxed text-ink">{linkifyGamertags(article.lede, roster)}</p>
```

Change the body (line 52) to:

```tsx
<ArticleBody blocks={article.bodyBlocks} fallback={article.body} className="mt-5" roster={roster} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/web run test -- src/components/obituaries/obituary-article.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/obituaries/obituary-article.tsx apps/web/src/components/obituaries/obituary-article.test.tsx
git commit -m "feat(web): linkify gamertags in the obituary interior"
```

---

### Task 6: The birth-notice interior

**Files:**
- Modify: `apps/web/src/components/birth-notices/birth-notice-article.tsx` (`ArticleBody` at line 46)
- Test: `apps/web/src/components/birth-notices/birth-notice-article.test.tsx` (append)

**Interfaces:**
- Consumes: `birthNoticeRoster` (Task 3), `ArticleBody`'s `roster` prop (Task 4).

**Note:** this interior renders **no lede** — verified by grep. Do not add one.

- [ ] **Step 1: Write the failing test**

```tsx
describe("birth notice prose linkification", () => {
  it("links the subject in the body", () => {
    render(
      <BirthNoticeArticleView
        article={{ ...baseArticle, gamertag: "Pyle", body: "Pyle drew breath on the coast.", bodyBlocks: null }}
        more={[]}
      />,
    );
    expect(screen.getByRole("link", { name: "Pyle" })).toHaveAttribute("href", "/players/pyle");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- src/components/birth-notices/birth-notice-article.test.tsx`
Expected: FAIL — no link rendered.

- [ ] **Step 3: Implement**

Add the import:

```tsx
import { birthNoticeRoster } from "@/lib/article-roster";
```

Inside the component:

```tsx
const roster = birthNoticeRoster(article);
```

Change line 46 to:

```tsx
<ArticleBody blocks={article.bodyBlocks} fallback={article.body} className="mt-6" roster={roster} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/web run test -- src/components/birth-notices/birth-notice-article.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/birth-notices/birth-notice-article.tsx apps/web/src/components/birth-notices/birth-notice-article.test.tsx
git commit -m "feat(web): linkify gamertags in the birth-notice interior"
```

---

### Task 7: The news and editorial interiors

**Files:**
- Modify: `apps/web/src/components/news/news-article.tsx` (lede at line 79, `ArticleBody` at line 91)
- Modify: `apps/web/src/components/news/editorial-article.tsx` (lede at line 63, `ArticleBody` at line 66)
- Test: `apps/web/src/components/news/news-article.test.tsx` and `apps/web/src/components/news/editorial-article.test.tsx` (append to each)

**Interfaces:**
- Consumes: `newsRoster` (Task 3), `linkifyGamertags` (Task 1), `ArticleBody`'s `roster` prop (Task 4).

**Note:** these are two separate components — an editorial piece renders through `editorial-article.tsx`, not `news-article.tsx`. Both need the change. An editorial piece's roster comes entirely from `article.subjects` (its `gamertag` is null).

- [ ] **Step 1: Write the failing tests**

In `news-article.test.tsx`:

```tsx
describe("news prose linkification", () => {
  it("links a subject in the lede and the body", () => {
    render(
      <NewsArticleView
        article={{
          ...baseArticle,
          gamertag: "Hartman",
          subjects: [{ gamertag: "Hartman", mapSlug: "sakhal", lifeNumber: 2 }],
          lede: "Hartman has not been seen.",
          body: "Hartman's tent is still standing.",
          bodyBlocks: null,
        }}
        {...baseProps}
      />,
    );
    expect(screen.getAllByRole("link", { name: "Hartman" })[0]).toHaveAttribute("href", "/players/hartman");
  });
});
```

In `editorial-article.test.tsx`:

```tsx
describe("editorial prose linkification", () => {
  it("links every gamertag the desk listed in subjects, though the article has no subject column", () => {
    render(
      <EditorialArticleView
        article={{
          ...baseArticle,
          gamertag: null,
          subjects: [
            { gamertag: "Hartman", mapSlug: null, lifeNumber: 1 },
            { gamertag: "Pyle", mapSlug: null, lifeNumber: 1 },
          ],
          lede: "Hartman leads the ledger.",
          body: "Pyle is second.",
          bodyBlocks: null,
        }}
        {...baseProps}
      />,
    );
    expect(screen.getByRole("link", { name: "Hartman" })).toHaveAttribute("href", "/players/hartman");
    expect(screen.getByRole("link", { name: "Pyle" })).toHaveAttribute("href", "/players/pyle");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- src/components/news`
Expected: FAIL — no links rendered in either.

- [ ] **Step 3: Implement in `news-article.tsx`**

Add the imports:

```tsx
import { newsRoster } from "@/lib/article-roster";
import { linkifyGamertags } from "@/lib/linkify-gamertags";
```

Inside the component:

```tsx
const roster = newsRoster(article);
```

Line 79 becomes:

```tsx
<p className="mt-6 font-mono text-[15px] font-bold leading-relaxed text-ink">{linkifyGamertags(article.lede, roster)}</p>
```

Line 91 becomes:

```tsx
<ArticleBody blocks={article.bodyBlocks} fallback={article.body} className="mt-5" roster={roster} />
```

- [ ] **Step 4: Implement in `editorial-article.tsx`**

Add the same two imports and `const roster = newsRoster(article);`.

Line 63 becomes:

```tsx
<p className="mt-6 font-display text-xl leading-snug text-ink">{linkifyGamertags(article.lede, roster)}</p>
```

Line 66 becomes:

```tsx
<ArticleBody blocks={article.bodyBlocks ?? null} fallback={article.body} roster={roster} />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/components/news`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/news/news-article.tsx apps/web/src/components/news/editorial-article.tsx apps/web/src/components/news/news-article.test.tsx apps/web/src/components/news/editorial-article.test.tsx
git commit -m "feat(web): linkify gamertags in the news and editorial interiors"
```

---

### Task 8: Validate the editorial roster at publish time

**Files:**
- Modify: `apps/newsdesk/src/newsroom/store.ts`
- Test: `apps/newsdesk/test/newsroom-store.test.ts` (append; create if absent)

**Interfaces:**
- Consumes: the existing `EditorialPayload.subjects` array (`contract.ts:26-30`) — already collected by the CLI and already written to `facts.subjects` by `store.ts:34`. **No contract change is needed.**
- Produces: `assertKnownSubjects(db, subjects): Promise<void>` — throws on the first gamertag with no matching `players` row.

**Why:** spec §6 requires that a typo'd callsign fails the publish rather than shipping a link to a 404. Now that `facts.subjects` drives linkification, an unvalidated entry becomes a broken public link.

- [ ] **Step 1: Write the failing test**

```ts
// apps/newsdesk/test/newsroom-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./helpers/db.js"; // reuse whatever harness the newsdesk tests already use
import { assertKnownSubjects } from "../src/newsroom/store.js";
import { players } from "@onelife/db";

describe("assertKnownSubjects", () => {
  beforeEach(async () => {
    await db.insert(players).values({ gamertag: "Hartman" });
  });

  it("passes for a gamertag that exists", async () => {
    await expect(assertKnownSubjects(db, [{ gamertag: "hartman" }])).resolves.toBeUndefined();
  });

  it("throws naming the unknown gamertag", async () => {
    await expect(assertKnownSubjects(db, [{ gamertag: "Hartmn" }])).rejects.toThrow(/Hartmn/);
  });

  it("accepts an empty subjects list", async () => {
    await expect(assertKnownSubjects(db, [])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk run test -- newsroom-store`
Expected: FAIL — `assertKnownSubjects` is not exported.

- [ ] **Step 3: Implement**

Add to `apps/newsdesk/src/newsroom/store.ts`:

```ts
import { players } from "@onelife/db";
import { sql } from "drizzle-orm";

/**
 * A subject roster is public link surface: `facts.subjects` drives prose linkification on the
 * article page, so an unknown gamertag ships a link to a 404. Fail the publish instead.
 * Compared case-insensitively — the desk writes prose casing, not stored casing.
 */
export async function assertKnownSubjects(
  db: Database,
  subjects: { gamertag: string }[],
): Promise<void> {
  for (const s of subjects) {
    const hit = await db
      .select({ gamertag: players.gamertag })
      .from(players)
      .where(sql`lower(${players.gamertag}) = lower(${s.gamertag})`)
      .limit(1);
    if (hit.length === 0) {
      throw new Error(
        `subjects names "${s.gamertag}", which is not a known player. ` +
        `Fix the callsign — a subject roster becomes links on the published page.`,
      );
    }
  }
}
```

Then call it in the publish path, immediately before the row is written (above the `facts:` assembly at line 34):

```ts
await assertKnownSubjects(db, p.subjects);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk run test -- newsroom-store`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/newsdesk/src/newsroom/store.ts apps/newsdesk/test/newsroom-store.test.ts
git commit -m "feat(newsdesk): reject an editorial subject roster naming an unknown player"
```

---

### Task 9: Full verification, changelog, CLAUDE.md

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

**Note:** the repo guard blocks the PR unless BOTH files changed on the branch. CLAUDE.md is deliberately last.

- [ ] **Step 1: Run the full suite and typechecker**

Run: `pnpm turbo run typecheck`
Expected: all tasks successful.
Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1 --env-mode=loose`
Expected: all tasks successful. Do not proceed on a failure.

- [ ] **Step 2: Add the changelog entry**

Under `## [Unreleased]` → `### Added` in `CHANGELOG.md`, in reader-facing voice:

```markdown
- Gamertags named in an article now link to that player's dossier — in obituaries, birth notices,
  news features, and the desk's editorial pieces, throughout the back catalogue as well as
  new writing.
```

- [ ] **Step 3: Update CLAUDE.md**

Extend the cross-linking entry with a PR-3 paragraph recording the invariants a future change would break by accident:

```markdown
- **Cross-linking, PR-3 — gamertags in prose** ✅: a gamertag named in an article's prose links to
  that player's dossier, via the pure `linkifyGamertags(text, roster)`
  (`apps/web/src/lib/linkify-gamertags.tsx`) applied in `ArticleBody` (para/quote/list **and the
  flat `body.split()` fallback** — the path the whole pre-0014 corpus still renders through) and to
  the lede on the obituary, news, and editorial interiors (the birth-notice interior renders no
  lede). Spec `docs/superpowers/specs/2026-07-21-prose-linkification-design.md`.
  **⚠️ The roster is per-article, never global** — `articleRoster` builders
  (`@/lib/article-roster`) read only fields already on the DTO (obituary: subject + killer; birth
  notice: subject; news/editorial: `gamertag` + `facts.subjects[]`). A global-roster "improvement"
  puts a link on any word that happens to be a callsign. There is no `article_subjects` table.
  **⚠️ No regex lookbehind.** Boundaries are checked by inspecting the characters either side of a
  match. Safari below 16.4 throws a syntax error when a lookbehind regex is CONSTRUCTED, which
  crashes the page rather than degrading. Alternatives are sorted longest-first because JS
  alternation is leftmost-first, not leftmost-longest.
  **The prose is never rewritten** — the matched text is rendered, so `hartman` in the copy stays
  `hartman`, linked to `/players/xsgt-hartman`. Matching is case-insensitive only, so the matched
  text and the roster entry share a slug; that is why `GamertagLink` needs no `children`.
  **An empty/omitted roster renders byte-identical DOM**, which is the regression guard for the
  legacy corpus and is pinned by a test. Subheads, headlines, kickers, captions, OG cards and feed
  cards are deliberately not linkified. In-prose links carry `red-deep` + a dotted underline —
  hover-only colour fails WCAG 1.4.1, and `red-deep` is light-surface-only.
  **`facts.subjects` is now public link surface**, so `newsroom` publish rejects a roster naming an
  unknown player (`assertKnownSubjects`) rather than shipping a link to a 404.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for prose linkification (cross-linking PR-3)"
```

- [ ] **Step 5: Open the PR**

Use the `finishing-a-feature` skill, which runs the gates in the order the repo guard expects and opens the PR into `develop`.

---

## Self-Review

**Spec coverage:** §3 approach → Tasks 1–7. §4.1 `articleRoster` → Task 3. §4.2 matcher rules → Task 1 (each rule has a test). §4.3 styling → Task 1's `PROSE_LINK_CLASS`; the `GamertagLink` `children` extension proved unnecessary, since case-insensitive matching means the matched text and roster entry produce the same slug — recorded in Task 1's Interfaces note and in the CLAUDE.md text. §5 call sites → Tasks 4–7, including the flat fallback and all four interiors. §6 editorial rosters → Task 8, reduced in scope by the discovery that the CLI already collects and stores `subjects`. §7 testing → the test blocks in Tasks 1, 3, 4, 5, 6, 7, 8. §8 deployment → plain deploy, no migration; nothing to do. §9 risks → accepted, no task.

**Placeholder scan:** none — every code step carries complete code and every run step an exact command with expected output.

**Type consistency:** `linkifyGamertags(text: string, roster: string[]): ReactNode[]` is used identically in Tasks 4–7. `roster` is the prop name everywhere. `PullQuote.text` is widened in Task 2 before Task 4 passes it nodes. `newsRoster` accepts `{gamertag: string | null; subjects: {gamertag: string}[]}`, which both `NewsArticleDetail` and the editorial DTO satisfy.

**One known unknown:** Tasks 5–7 append to existing test files whose fixture builders this plan has not read. The implementer must reuse the local fixture (`baseArticle`/`baseProps` are placeholders for whatever those files already define) rather than inventing a new one.
