# Terms & Conditions and Privacy Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/terms` and `/privacy` on dayzonelife.com — two static prose pages that disclose what One Life collects, promise only the deletion the append-only event log can actually deliver, and give account-level enforcement a written basis.

**Architecture:** Content is authored as typed `LegalSection[]` data modules and rendered by one shared presentational component, `LegalDoc` — the same idiom `/about` already uses for its `STEPS` and `RULES` arrays. Two thin route files under `app/(site)/(boxed)/` do nothing but pick a content module and supply metadata. Three wiring changes follow: the footer link row, the sitemap's static paths, and a consent line on the login page.

**Tech Stack:** Next.js App Router (RSC, no `"use client"` anywhere in this work), TypeScript, Tailwind, Vitest + React Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-07-29-legal-pages-design.md`

## Global Constraints

- **Contact address is `admin@dayzonelife.com`** and it is the *only* contact on either page. It appears in Terms §1, Terms §9, Privacy §10, Privacy §11, and Privacy §13. Never introduce a second address.
- **Governing law is Arizona, USA.**
- **Voice: plain and direct, second person, short declarative sentences.** No "the Service", no "the Company", no numbered sub-clauses, no tabloid jokes. Legal pages are where a joke costs trust.
- **Copy in this plan is final copy.** Type it as written. Do not paraphrase, shorten, or "improve" it — several sentences are load-bearing disclosures pinned by tests.
- **No new dependencies.** No MDX, no markdown renderer, no date library.
- **Both pages are fully static** — no `fetch`, no `async`, no API call. The repo's loading/failed/empty/zero rule does not apply because nothing can degrade.
- **Every file created here is a server component.** Adding `"use client"` to any of them is a defect.
- Run tests with `pnpm --filter @onelife/web run test`. Typecheck with `pnpm --filter @onelife/web run typecheck`.
- Branch is `feature/legal-pages`, already created, with the spec already committed on it.

---

### Task 1: `LegalDoc` component, section type, and the shared effective date

**Files:**
- Create: `apps/web/src/components/legal/legal-doc.tsx`
- Create: `apps/web/src/content/legal/effective-date.ts`
- Test: `apps/web/src/components/legal/legal-doc.test.tsx`

**Interfaces:**
- Consumes: `Kicker` from `@/components/tabloid/kicker` (existing; `{ children, color? }`).
- Produces:
  - `export interface LegalSection { id: string; heading: string; body: ReactNode }`
  - `export interface LegalDocProps { kicker: string; title: string; standfirst: string; effectiveDate: string; sections: LegalSection[] }`
  - `export function LegalDoc(props: LegalDocProps): JSX.Element`
  - `export const EFFECTIVE_DATE: string` from `@/content/legal/effective-date`

Tasks 2 and 3 import all four.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/legal/legal-doc.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { LegalDoc } from "./legal-doc";

const SECTIONS = [
  { id: "who-runs-this", heading: "Who runs this", body: <p>One person, as a hobby.</p> },
  { id: "governing-law", heading: "Governing law", body: <p>Arizona, USA.</p> },
];

const doc = () =>
  render(
    <LegalDoc
      kicker="The fine print"
      title="Terms & Conditions"
      standfirst="These cover the website and the servers."
      effectiveDate="29 July 2026"
      sections={SECTIONS}
    />,
  );

it("renders the title, the standfirst and the effective date", () => {
  doc();
  expect(screen.getByRole("heading", { level: 1, name: "Terms & Conditions" })).toBeInTheDocument();
  expect(screen.getByText("These cover the website and the servers.")).toBeInTheDocument();
  expect(screen.getByText(/Last updated 29 July 2026/)).toBeInTheDocument();
});

it("renders one heading and one body per section, in order", () => {
  doc();
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(["Who runs this", "Governing law"]);
  expect(screen.getByText("One person, as a hobby.")).toBeInTheDocument();
  expect(screen.getByText("Arizona, USA.")).toBeInTheDocument();
});

// ⚠️ The id is the whole reason sections are data rather than inline markup: a deletion request
// gets answered with a link straight to the clause. Losing it is silent — the page still renders.
it("gives every section its id as an anchor target, and labels it by its own heading", () => {
  const { container } = doc();
  for (const s of SECTIONS) {
    const el = container.querySelector(`#${s.id}`);
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("SECTION");
    const labelledBy = el!.getAttribute("aria-labelledby");
    expect(labelledBy).not.toBeNull();
    expect(container.querySelector(`#${labelledBy}`)!.textContent).toBe(s.heading);
  }
});

// jsdom cannot see a heading sliding under the sticky masthead, so the contract is pinned as a
// class: without scroll-mt, following a #clause link lands the heading behind the header.
it("offsets anchor scrolling so a linked clause clears the masthead", () => {
  const { container } = doc();
  expect(container.querySelector("#who-runs-this")!.className).toMatch(/scroll-mt-/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @onelife/web run test -- legal-doc`
Expected: FAIL — `Failed to resolve import "./legal-doc"`.

- [ ] **Step 3: Write the component and the effective-date constant**

Create `apps/web/src/content/legal/effective-date.ts`:

```ts
/**
 * One constant, printed by BOTH legal pages. Two separately-maintained dates would eventually
 * disagree, and a stale date on a legal page is a claim about when you last told the truth.
 * Bump this whenever either document's substance changes — not for typo fixes.
 */
export const EFFECTIVE_DATE = "29 July 2026";
```

Create `apps/web/src/components/legal/legal-doc.tsx`:

```tsx
import type { ReactNode } from "react";
import { Kicker } from "@/components/tabloid/kicker";

/** One clause of a legal document. `id` is a stable anchor — see the test for why it matters. */
export interface LegalSection {
  id: string;
  heading: string;
  body: ReactNode;
}

export interface LegalDocProps {
  kicker: string;
  title: string;
  standfirst: string;
  effectiveDate: string;
  sections: LegalSection[];
}

/**
 * Presentation only — this component holds no copy of its own. Both legal pages render through
 * it so they cannot drift apart typographically, which is the whole reason the content lives in
 * data modules rather than in two hand-written pages.
 *
 * `max-w-3xl`, narrower than /about's `max-w-5xl`: this is one column of continuous prose, and a
 * 5xl measure is unreadable for it.
 */
export function LegalDoc({ kicker, title, standfirst, effectiveDate, sections }: LegalDocProps) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-14">
      <header className="border-b-[3px] border-ink pb-8">
        <Kicker>{kicker}</Kicker>
        <h1 className="mt-3 font-display text-4xl font-bold uppercase leading-[.9] md:text-6xl">
          {title}
        </h1>
        <p className="mt-5 font-sans text-lg leading-relaxed text-ink-soft">{standfirst}</p>
        <p className="mt-5 font-mono text-xs uppercase tracking-[.06em] text-ink-muted">
          Last updated {effectiveDate}
        </p>
      </header>

      {sections.map((s) => (
        // scroll-mt-24 clears the sticky masthead when someone follows a #clause link.
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`} className="mt-10 scroll-mt-24">
          <h2
            id={`${s.id}-heading`}
            className="border-b-[3px] border-ink pb-2 font-display text-2xl font-bold uppercase"
          >
            {s.heading}
          </h2>
          <div className="mt-4 space-y-4 font-sans text-base leading-relaxed text-ink-soft">
            {s.body}
          </div>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @onelife/web run test -- legal-doc`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/legal/legal-doc.tsx apps/web/src/components/legal/legal-doc.test.tsx apps/web/src/content/legal/effective-date.ts
git commit -m "feat(web): LegalDoc component and shared effective date"
```

---

### Task 2: Terms & Conditions content and route

**Files:**
- Create: `apps/web/src/content/legal/terms.tsx`
- Create: `apps/web/src/app/(site)/(boxed)/terms/page.tsx`
- Test: `apps/web/src/app/(site)/(boxed)/terms/page.test.tsx`

**Interfaces:**
- Consumes: `LegalSection`, `LegalDoc`, `EFFECTIVE_DATE` from Task 1.
- Produces: `export const TERMS_SECTIONS: LegalSection[]` from `@/content/legal/terms`; a default-exported `TermsPage` component at `/terms`.

The content module is `.tsx`, not `.ts`, because section bodies are JSX.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(site)/(boxed)/terms/page.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import TermsPage from "./page";

const text = () => render(<TermsPage />).container.textContent ?? "";

// ⚠️ These assert CONTENT, not counts. Each one is a disclosure or a limitation that a later
// copy edit could shorten away without any other test noticing. If one of these fails, the fix
// is to restore the clause — not to relax the assertion.
describe("load-bearing clauses", () => {
  it("publishes the contact address", () => {
    expect(text()).toContain("admin@dayzonelife.com");
  });

  it("disclaims affiliation with the game and platform holders", () => {
    const t = text();
    for (const party of ["Bohemia Interactive", "Microsoft", "Xbox", "Nitrado"]) {
      expect(t).toContain(party);
    }
    expect(t).toMatch(/not affiliated with/i);
  });

  it("states that unban tokens have no cash value and are not owed back", () => {
    const t = text();
    expect(t).toMatch(/no cash value/i);
    expect(t).toMatch(/cannot be bought/i);
  });

  it("states that obituaries are machine-written and not statements of fact about the player", () => {
    const t = text();
    expect(t).toMatch(/written by a machine/i);
    expect(t).toMatch(/not statements of fact about you/i);
  });

  it("names Arizona as the governing law", () => {
    expect(text()).toMatch(/State of Arizona/);
  });

  it("distinguishes the mechanical 24-hour ban from a discretionary admin ban", () => {
    const t = text();
    expect(t).toMatch(/24-hour ban is mechanical/i);
    expect(t).toMatch(/An admin ban is a decision/i);
  });
});

it("prints the shared effective date", async () => {
  const { EFFECTIVE_DATE } = await import("@/content/legal/effective-date");
  expect(text()).toContain(EFFECTIVE_DATE);
});

it("gives every clause a unique, non-empty anchor id", async () => {
  const { TERMS_SECTIONS } = await import("@/content/legal/terms");
  const ids = TERMS_SECTIONS.map((s) => s.id);
  expect(ids.every((id) => id.length > 0)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  expect(TERMS_SECTIONS.every((s) => s.heading.length > 0)).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @onelife/web run test -- terms`
Expected: FAIL — `Failed to resolve import "./page"`.

- [ ] **Step 3: Write the content module**

Create `apps/web/src/content/legal/terms.tsx`. Type the copy exactly as written:

```tsx
import type { LegalSection } from "@/components/legal/legal-doc";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "who-runs-this",
    heading: "Who runs this",
    body: (
      <>
        <p>
          One Life is run by one person, in the United States, as a hobby. There is no company
          behind it. You can reach me at <a className="underline decoration-red decoration-2 underline-offset-2" href="mailto:admin@dayzonelife.com">admin@dayzonelife.com</a>.
        </p>
        <p>
          One Life is not affiliated with, endorsed by, or connected to Bohemia Interactive, the
          makers of DayZ, Microsoft, Xbox, or Nitrado. DayZ is their game. This is a community
          project built on top of it.
        </p>
      </>
    ),
  },
  {
    id: "who-can-play",
    heading: "Who can play",
    body: (
      <p>
        You must be at least 13 to have an account here. DayZ carries an adult rating in most
        countries, and your Xbox account has its own terms and age rules. Meeting those is your
        responsibility, not mine.
      </p>
    ),
  },
  {
    id: "your-account",
    heading: "Your account",
    body: (
      <p>
        You sign in with Discord. One account per person. Anything done through your account is
        treated as done by you, so don&rsquo;t share it. If you lose access to your Discord
        account you lose access to this one — email me and we&rsquo;ll sort it out.
      </p>
    ),
  },
  {
    id: "your-gamertag",
    heading: "Your gamertag",
    body: (
      <>
        <p>
          You may link one Xbox gamertag to your account, and you only get to do it once. To prove
          the tag is yours, the site gives you three emotes to perform in-game, in order. Anyone
          can start a claim on any tag; only the person holding the controller finishes it.
          Unfinished claims expire after 24 hours, and where two people claim the same tag, the
          first to finish the emotes gets it.
        </p>
        <p>Deliberately claiming a tag that isn&rsquo;t yours will cost you your account.</p>
      </>
    ),
  },
  {
    id: "unban-tokens",
    heading: "Unban tokens",
    body: (
      <>
        <p>
          Unban tokens are earned — by verifying your gamertag, by turning up each month, and by
          referrals. They cannot be bought, and there is nothing here to buy them with.
        </p>
        <p>
          Tokens have no cash value. They are not property, not currency, and not redeemable for
          money or for anything outside this site. Transfers between players are final and cannot
          be reversed.
        </p>
        <p>
          Tokens gained through a bug or an exploit can be taken back. If the token economy changes,
          or One Life shuts down, your tokens are worth nothing and you are owed nothing for them.
        </p>
      </>
    ),
  },
  {
    id: "the-record",
    heading: "The record",
    body: (
      <>
        <p>
          Every qualified life is published: how long you lived, who killed you, with what, from how
          far, and where it ended. That record is public and it is permanent. Deleting your account
          does not remove it.
        </p>
        <p>
          Obituaries are written by a machine, and they are written to be unkind. They are
          commentary on the death of a character in a video game — they are not statements of fact
          about you, your ability, or your character. If one crosses a line, email me and I&rsquo;ll
          look at it.
        </p>
      </>
    ),
  },
  {
    id: "server-conduct",
    heading: "Rules on the servers",
    body: (
      <>
        <p>These will get you removed, from the servers and from this site:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Cheating — mods, scripts, injectors, or anything that isn&rsquo;t the game as shipped.</li>
          <li>Duping, clipping through walls or objects, and farming a bug instead of reporting it.</li>
          <li>Ban evasion — playing out your 24 hours on another gamertag or another account.</li>
          <li>Harassment, slurs, or following a player off the server to keep at them.</li>
          <li>Posting anyone&rsquo;s real-world information.</li>
          <li>Threats of real-world violence.</li>
        </ul>
        <p>Losing a fight is not harassment. Being killed on sight is the game.</p>
      </>
    ),
  },
  {
    id: "what-you-upload",
    heading: "What you upload",
    body: (
      <>
        <p>
          The only thing you can upload is an avatar. It stays yours — you are giving permission to
          display it on this site, nothing more.
        </p>
        <p>
          Don&rsquo;t upload anything illegal, hateful, sexual, or that belongs to somebody else.
          Any avatar can be removed without warning.
        </p>
      </>
    ),
  },
  {
    id: "enforcement",
    heading: "Bans and appeals",
    body: (
      <>
        <p>There are two kinds of ban here and they are not the same thing.</p>
        <p>
          The 24-hour ban is mechanical. Your life ended, so the clock started. It is not a
          judgement about you and there is nothing to appeal — wait it out, or spend a token.
        </p>
        <p>
          An admin ban is a decision. It can be permanent, it can cover every server, and it can
          take your account and your tokens with it. If you think one was wrong, email{" "}
          <a className="underline decoration-red decoration-2 underline-offset-2" href="mailto:admin@dayzonelife.com">admin@dayzonelife.com</a>.
          You&rsquo;ll get an answer. You may not get a reversal, and I&rsquo;m not obliged to
          explain how I know what I know.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    heading: "Availability",
    body: (
      <>
        <p>This is a hobby, run by one person, on rented servers. Nothing here is promised to keep working.</p>
        <p>
          Servers can go down, get wiped, get moved, or be shut down for good. Data can be lost.
          Features can disappear. Your record, your tokens and your account can go with them, and
          nothing is owed to you if they do.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    heading: "Disclaimers",
    body: (
      <p>
        One Life is provided as-is, with no warranties of any kind, express or implied. There is no
        promise that it will be available, accurate, secure, or fit for any particular purpose.
      </p>
    ),
  },
  {
    id: "liability",
    heading: "Liability",
    body: (
      <p>
        To the fullest extent the law allows, I am not liable for any indirect, incidental, special
        or consequential damages arising out of your use of One Life. Where liability cannot be
        excluded, it is limited to what you have paid to use One Life — which is nothing.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "Changes to these terms",
    body: (
      <p>
        These terms can change. When they do, the date at the top changes with them, and continuing
        to use the site or the servers after that means you accept the new version. Nothing gets
        slipped in quietly.
      </p>
    ),
  },
  {
    id: "governing-law",
    heading: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of the State of Arizona, USA, without regard to its
        conflict-of-law rules. Any dispute goes to the state or federal courts sitting in Arizona.
      </p>
    ),
  },
];
```

- [ ] **Step 4: Write the route**

Create `apps/web/src/app/(site)/(boxed)/terms/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/legal/legal-doc";
import { TERMS_SECTIONS } from "@/content/legal/terms";
import { EFFECTIVE_DATE } from "@/content/legal/effective-date";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "The rules for the One Life website and the One Life servers — accounts, gamertags, unban tokens, the record, and what gets you banned.",
};

export default function TermsPage() {
  return (
    <>
      <LegalDoc
        kicker="The fine print"
        title="Terms & Conditions"
        standfirst="These cover the One Life website and the One Life servers. Using either means you accept them."
        effectiveDate={EFFECTIVE_DATE}
        sections={TERMS_SECTIONS}
      />
      <p className="mx-auto w-full max-w-3xl px-6 pb-10 font-mono text-xs uppercase tracking-[.06em] text-ink-muted md:px-10">
        See also the{" "}
        <Link href="/privacy" className="underline decoration-red decoration-2 underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </>
  );
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `pnpm --filter @onelife/web run test -- terms`
Expected: PASS, 8 tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/content/legal/terms.tsx "apps/web/src/app/(site)/(boxed)/terms"
git commit -m "feat(web): terms & conditions page"
```

---

### Task 3: Privacy Policy content and route

**Files:**
- Create: `apps/web/src/content/legal/privacy.tsx`
- Create: `apps/web/src/app/(site)/(boxed)/privacy/page.tsx`
- Test: `apps/web/src/app/(site)/(boxed)/privacy/page.test.tsx`

**Interfaces:**
- Consumes: `LegalSection`, `LegalDoc`, `EFFECTIVE_DATE` from Task 1.
- Produces: `export const PRIVACY_SECTIONS: LegalSection[]` from `@/content/legal/privacy`; a default-exported `PrivacyPage` component at `/privacy`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(site)/(boxed)/privacy/page.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { it, expect, describe } from "vitest";
import PrivacyPage from "./page";

const text = () => render(<PrivacyPage />).container.textContent ?? "";

// ⚠️ These assert CONTENT, not counts. Each is a disclosure a later copy edit could shorten away
// with no other test noticing. If one fails, restore the clause — do not relax the assertion.
describe("load-bearing disclosures", () => {
  it("publishes the contact address", () => {
    expect(text()).toContain("admin@dayzonelife.com");
  });

  // The single sharpest omission risk on this page: players cannot guess that their gamertag is
  // sent to a third-party LLM to have an obituary written about them.
  it("discloses that gamertags and death details go to OpenRouter and Anthropic", () => {
    const t = text();
    expect(t).toContain("OpenRouter");
    expect(t).toContain("Anthropic");
    expect(t).toMatch(/your killer&rsquo;s gamertag|your killer’s gamertag/);
  });

  it("discloses IP address and user-agent storage on the session", () => {
    const t = text();
    expect(t).toMatch(/IP address/i);
    expect(t).toMatch(/user-agent/i);
  });

  it("discloses that map coordinates are recorded", () => {
    expect(text()).toMatch(/position on the map/i);
  });

  it("states that chat is not recorded", () => {
    expect(text()).toMatch(/Chat is not recorded/i);
  });

  it("states there are no ads, analytics or trackers, and nothing is sold", () => {
    const t = text();
    expect(t).toMatch(/no analytics/i);
    expect(t).toMatch(/no tracking scripts/i);
  });

  // The promise the architecture has to keep. Softening either half is a defect.
  it("promises account deletion while stating the gameplay record stands", () => {
    const t = text();
    expect(t).toMatch(/Not deleted/i);
    expect(t).toMatch(/append-only/i);
  });

  it("states retention honestly as indefinite", () => {
    expect(text()).toMatch(/Indefinitely/i);
  });
});

it("prints the shared effective date", async () => {
  const { EFFECTIVE_DATE } = await import("@/content/legal/effective-date");
  expect(text()).toContain(EFFECTIVE_DATE);
});

it("gives every clause a unique, non-empty anchor id", async () => {
  const { PRIVACY_SECTIONS } = await import("@/content/legal/privacy");
  const ids = PRIVACY_SECTIONS.map((s) => s.id);
  expect(ids.every((id) => id.length > 0)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  expect(PRIVACY_SECTIONS.every((s) => s.heading.length > 0)).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @onelife/web run test -- privacy`
Expected: FAIL — `Failed to resolve import "./page"`.

- [ ] **Step 3: Write the content module**

Create `apps/web/src/content/legal/privacy.tsx`. Type the copy exactly as written:

```tsx
import type { LegalSection } from "@/components/legal/legal-doc";

const MAILTO = (
  <a className="underline decoration-red decoration-2 underline-offset-2" href="mailto:admin@dayzonelife.com">
    admin@dayzonelife.com
  </a>
);

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "the-short-version",
    heading: "The short version",
    body: (
      <>
        <p>
          There are no ads on this site, no analytics, and no tracking scripts of any kind. Nothing
          about you is sold, rented, or handed to a data broker.
        </p>
        <p>
          What is collected falls into three piles: what Discord tells us when you sign in, what
          your browser tells us while you&rsquo;re here, and what the game servers write down while
          you play. The last is the big one, and it includes where you were standing.
        </p>
      </>
    ),
  },
  {
    id: "signing-in",
    heading: "What signing in gives us",
    body: (
      <>
        <p>
          You sign in with Discord. Discord passes over your display name, your email address, your
          Discord avatar image, and your Discord account ID. We also store the access and refresh
          tokens Discord issues, which are what let the site confirm you are still you.
        </p>
        <p>We never see your Discord password, and we cannot read your Discord messages.</p>
      </>
    ),
  },
  {
    id: "your-browser",
    heading: "What your browser gives us",
    body: (
      <>
        <p>A session cookie, so you stay signed in. It is the only cookie this site sets.</p>
        <p>
          Stored alongside that session: your IP address and your browser&rsquo;s user-agent string.
          That is the standard record of where a sign-in came from, and it is how a stolen session
          gets spotted.
        </p>
        <p>
          If you turn on notifications, we also store the push endpoint your browser hands out, the
          two keys that let us encrypt messages to it, and that device&rsquo;s user-agent.
        </p>
      </>
    ),
  },
  {
    id: "game-servers",
    heading: "What the game servers record",
    body: (
      <>
        <p>
          The DayZ server writes an admin log. We read it line by line, and that log is where most
          of what this site knows comes from:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>your gamertag, and every time you connect and disconnect</li>
          <li>your position on the map, sampled continuously while you are alive</li>
          <li>kills, hits, going unconscious, dying, and building</li>
          <li>the emotes you perform — which is how gamertag verification works</li>
        </ul>
        <p>
          Your position data is the most sensitive thing here, and it is handled that way. See{" "}
          <a className="underline decoration-red decoration-2 underline-offset-2" href="#who-sees-what">
            Who sees what
          </a>
          .
        </p>
        <p>Chat is not recorded. The log parser has no handling for it at all.</p>
      </>
    ),
  },
  {
    id: "what-you-add",
    heading: "What you add yourself",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>An avatar, if you upload one — the image itself is stored in our database.</li>
        <li>Your gamertag claim.</li>
        <li>Your friendships and friend requests.</li>
        <li>
          Your per-friend switches for sharing live location and presence. Both are off unless you
          turn them on.
        </li>
      </ul>
    ),
  },
  {
    id: "who-sees-what",
    heading: "Who sees what",
    body: (
      <>
        <p>
          <strong>Public</strong>, to anyone, signed in or not: your gamertag, your lives, how long
          each lasted, how it ended, your kills, your obituaries, and your position on the boards.
        </p>
        <p>
          <strong>Yours alone</strong>: your email address, your IP addresses, and your map
          coordinates. The routes that serve coordinates take no player parameter at all — there is
          no field in which to name somebody else — and they are marked never to be cached or
          stored by anything in between.
        </p>
        <p>
          <strong>Friends only, and only if you switch it on</strong>: your live location and
          whether you are currently playing. Off by default, set per friend, and revocable at any
          time.
        </p>
      </>
    ),
  },
  {
    id: "who-else",
    heading: "Who else touches it",
    body: (
      <>
        <p>Nobody buys this data. Four parties see some of it because they have to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Discord</strong> — handles your sign-in.
          </li>
          <li>
            <strong>Nitrado</strong> — hosts the game servers that write the logs.
          </li>
          <li>
            <strong>Your browser&rsquo;s push service</strong> (Apple, Google or Mozilla, depending
            on your device) — only if you enable notifications, and only to deliver them.
          </li>
          <li>
            <strong>OpenRouter and Anthropic</strong> — obituaries are written by Anthropic&rsquo;s
            Claude model, reached through OpenRouter. To write one, we send your gamertag, your
            killer&rsquo;s gamertag, and the details of the death: map, time survived, cause,
            weapon, distance, and your record going in. Your account, email and IP address are not
            sent.
          </li>
        </ul>
        <p>
          Beyond that: I will hand over data where the law requires it, and I will say so publicly
          unless I am barred from saying so.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    heading: "Cookies",
    body: (
      <p>
        One cookie: the session cookie that keeps you signed in. No analytics cookies, no
        advertising cookies, no third-party cookies. There is no consent banner because there is
        nothing to consent to.
      </p>
    ),
  },
  {
    id: "how-long",
    heading: "How long it is kept",
    body: (
      <>
        <p>Indefinitely. There is no automatic deletion of anything and no expiry schedule.</p>
        <p>
          That is deliberate for the gameplay record — the premise of One Life is that the record is
          permanent — and it is simply the truth for everything else. Rather than publish a
          retention schedule that no actual job enforces, here is the honest version: it stays until
          you ask for it to go, or until the site shuts down.
        </p>
      </>
    ),
  },
  {
    id: "deleting-your-account",
    heading: "Deleting your account",
    body: (
      <>
        <p>
          Email {MAILTO} from the address on your account, or give me your gamertag and I will
          verify it another way.
        </p>
        <p>
          <strong>Deleted</strong>: your account, your name and email, the tokens Discord issued,
          every session — and with them the stored IP addresses and user-agents — your avatar, your
          push subscriptions, your friendships, your preferences, your location shares, your unban
          token balance and its history, and your gamertag link.
        </p>
        <p>
          <strong>Not deleted</strong>: your gameplay record and your obituaries. Lives, deaths,
          kills and positions live in an append-only log that every part of this site is rebuilt
          from; pulling a gamertag out of it would break the rebuild the whole system depends on. It
          is also the premise of the product. Once your account is gone, that record stands on its
          own with nothing here tying it to you.
        </p>
        <p>
          If one specific obituary is the problem, say so. That is a conversation, not a policy.
        </p>
      </>
    ),
  },
  {
    id: "under-13s",
    heading: "Under-13s",
    body: (
      <p>
        One Life is not for anyone under 13, and accounts are not knowingly created for them. If you
        believe a child under 13 has an account here, email {MAILTO} and it will be removed.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "Changes to this policy",
    body: (
      <p>
        This policy can change, and the date at the top changes with it. If something material
        changes about what is collected or who receives it, that gets called out rather than quietly
        edited in.
      </p>
    ),
  },
  {
    id: "contact",
    heading: "Contact",
    body: <p>{MAILTO}. One person reads it.</p>,
  },
];
```

- [ ] **Step 4: Write the route**

Create `apps/web/src/app/(site)/(boxed)/privacy/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/legal/legal-doc";
import { PRIVACY_SECTIONS } from "@/content/legal/privacy";
import { EFFECTIVE_DATE } from "@/content/legal/effective-date";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What One Life collects about you, who else sees it, how long it is kept, and how to have it deleted. No ads, no analytics, nothing sold.",
};

export default function PrivacyPage() {
  return (
    <>
      <LegalDoc
        kicker="What we know about you"
        title="Privacy Policy"
        standfirst="What One Life collects, why, who else sees it, and how to get it deleted. No ads, no analytics, nothing sold."
        effectiveDate={EFFECTIVE_DATE}
        sections={PRIVACY_SECTIONS}
      />
      <p className="mx-auto w-full max-w-3xl px-6 pb-10 font-mono text-xs uppercase tracking-[.06em] text-ink-muted md:px-10">
        See also the{" "}
        <Link href="/terms" className="underline decoration-red decoration-2 underline-offset-2">
          Terms &amp; Conditions
        </Link>
        .
      </p>
    </>
  );
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `pnpm --filter @onelife/web run test -- privacy`
Expected: PASS, 10 tests.

If the killer-gamertag assertion fails on the apostrophe, the cause is the `&rsquo;` entity
rendering to `’` in `textContent`; the test's regex already accepts both forms, so a failure there
means the phrase itself is missing, not the punctuation.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/content/legal/privacy.tsx "apps/web/src/app/(site)/(boxed)/privacy"
git commit -m "feat(web): privacy policy page"
```

---

### Task 4: Four-link footer

**Files:**
- Modify: `apps/web/src/components/footer.tsx`
- Test: `apps/web/src/components/footer.test.tsx` (extend)

**Interfaces:**
- Consumes: the `/terms` and `/privacy` routes from Tasks 2 and 3.
- Produces: nothing other tasks import.

⚠️ Read the two existing comments in `footer.tsx` before editing. The
`pb-[calc(18px+4rem+env(safe-area-inset-bottom))]` gutter must stay **on the `<footer>` element**,
not move to the layout's content column — that comment records a shipped bug where the fixed
TabBar painted over the About link and made it unreachable on a phone. A second row of links makes
that gutter more load-bearing, not less.

- [ ] **Step 1: Add the failing tests**

Append to `apps/web/src/components/footer.test.tsx`:

```tsx
it("links to the legal pages", () => {
  render(<Footer />);
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
});

// ⚠️ Four links do not fit one line in a 320px column. jsdom cannot measure that, so the wrap
// contract is pinned as a class on the link row — the on-device check is a separate item.
it("lets the link row wrap rather than overflow a narrow column", () => {
  render(<Footer />);
  const nav = screen.getByRole("navigation", { name: /site information/i });
  expect(nav.className).toContain("flex-wrap");
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @onelife/web run test -- footer`
Expected: FAIL — `Unable to find an accessible element with the role "link" and name "Terms"`.

- [ ] **Step 3: Rewrite the footer**

Replace the body of `apps/web/src/components/footer.tsx` with:

```tsx
import Link from "next/link";

/** About lives here because the mobile TabBar carries the other four nav items and About is the
 *  one section a player visits once. Below `md` the footer is its only reachable route.
 *  Obituaries is in both — the tab bar as "Obits", here in full — because the short form is a
 *  compromise for a 320px column, not the surface's name.
 *  Terms and Privacy are footer-only by design: nobody navigates to them, they are reached from
 *  here and from the sign-in consent line. */
const LINKS = [
  { href: "/about", label: "About" },
  { href: "/obituaries", label: "Obituaries" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

const linkClass = "underline decoration-dark-line underline-offset-4 hover:text-red";

export function Footer() {
  return (
    // ⚠️ The bottom gutter for the fixed TabBar lives HERE, not on the layout's content column.
    // The footer is a sibling AFTER that column, so it is the last in-flow element in the
    // document — padding the column leaves the footer itself under the bar. Verified in a
    // browser: with the gutter on the column, scrolling to the bottom of /survivors put the bar
    // directly over this About link, and `elementFromPoint` returned the bar. About is the
    // footer's only route below `md`, so that made it unreachable on a phone.
    <footer className="bg-dark px-10 pt-[18px] pb-[calc(18px+4rem+env(safe-area-inset-bottom))] text-center font-mono text-xs uppercase tracking-[.08em] text-paper md:pb-[18px]">
      {/* ⚠️ flex-wrap, not a single line: four links overflow a 320px column. The separators are
          aria-hidden so a screen reader hears four links, not "About middot Obituaries". */}
      <nav aria-label="Site information" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {LINKS.map((l, i) => (
          <span key={l.href} className="flex items-center gap-x-2">
            {i > 0 && <span aria-hidden>·</span>}
            <Link href={l.href} className={linkClass}>
              {l.label}
            </Link>
          </span>
        ))}
      </nav>
      <p className="mt-2">One Life — hardcore · 1PP · US servers</p>
    </footer>
  );
}
```

- [ ] **Step 4: Run the whole footer suite and verify it passes**

Run: `pnpm --filter @onelife/web run test -- footer`
Expected: PASS, 6 tests — including the two pre-existing regression guards for the colophon text
and the `pb-[calc(...)]` / `md:pb-[18px]` gutter classes. If either of those two now fails, the
gutter has been moved or the colophon reworded; restore it rather than editing the test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/footer.tsx apps/web/src/components/footer.test.tsx
git commit -m "feat(web): footer links to terms and privacy, wrapping on narrow columns"
```

---

### Task 5: Sitemap entries

**Files:**
- Modify: `apps/web/src/app/sitemap.ts:24`
- Test: `apps/web/src/app/sitemap.test.ts:32` (extend)

**Interfaces:**
- Consumes: the `/terms` and `/privacy` routes from Tasks 2 and 3.
- Produces: nothing other tasks import.

- [ ] **Step 1: Extend the failing test**

In `apps/web/src/app/sitemap.test.ts`, change the static-pages assertion at line 32 to:

```ts
  it("includes the home page and the static pages", async () => {
    const u = await urls();
    for (const p of ["", "/about", "/obituaries", "/terms", "/privacy"]) {
      expect(u).toContain(`https://dayzonelife.com${p}`);
    }
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @onelife/web run test -- sitemap`
Expected: FAIL — the array does not contain `https://dayzonelife.com/terms`.

- [ ] **Step 3: Add the paths**

In `apps/web/src/app/sitemap.ts`, change line 24 to:

```ts
const STATIC_PATHS = ["/", "/about", "/obituaries", "/terms", "/privacy"];
```

Leave the comment above it as-is — the "no fabricated `lastmod`" rule applies to the new paths for
exactly the same reason.

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @onelife/web run test -- sitemap`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/sitemap.ts apps/web/src/app/sitemap.test.ts
git commit -m "feat(web): list terms and privacy in the sitemap"
```

---

### Task 6: Sign-in consent line

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/login/page.tsx`
- Test: `apps/web/src/app/(site)/(boxed)/login/page.test.tsx` (create)

**Interfaces:**
- Consumes: the `/terms` and `/privacy` routes from Tasks 2 and 3.
- Produces: nothing other tasks import.

The line sits **outside** the three-way conditional, at the bottom of `<main>`. All three states —
Discord-only, the full login panel, and the API-down alert — are sign-in surfaces, and a consent
line that only renders in one of them is a consent line that half the users never see.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(site)/(boxed)/login/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ getAuthMethods: vi.fn() }));
vi.mock("@/components/discord-redirect", () => ({ DiscordRedirect: () => <div>discord</div> }));
vi.mock("@/components/login-panel", () => ({ LoginPanel: () => <div>panel</div> }));

import { getAuthMethods } from "@/lib/api";
import LoginPage from "./page";

const DISCORD_ONLY = { providers: ["discord"], magicLink: false };

beforeEach(() => {
  vi.mocked(getAuthMethods).mockResolvedValue(DISCORD_ONLY as never);
});

it("tells you what signing in commits you to, and links both documents", async () => {
  render(await LoginPage());
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
});

// ⚠️ The consent line sits outside the three-way state switch on purpose. A line that renders
// only in the happy path is one that half the users never see.
it("shows the consent line even when the API is down and no method renders", async () => {
  vi.mocked(getAuthMethods).mockRejectedValue(new Error("down"));
  render(await LoginPage());
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Terms" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @onelife/web run test -- login`
Expected: FAIL — `Unable to find an accessible element with the role "link" and name "Terms"`.

- [ ] **Step 3: Add the consent line**

In `apps/web/src/app/(site)/(boxed)/login/page.tsx`, add `import Link from "next/link";` at the
top, then insert immediately after the closing `</div>` of the `<div className="mt-6">` block and
before `</main>`:

```tsx
      {/* ⚠️ Outside the state switch above: all three branches are sign-in surfaces, and a
          consent line rendered in only one of them is one most users never see. */}
      <p className="mt-6 font-mono text-[11px] uppercase leading-relaxed tracking-[.03em] text-ink-muted">
        Signing in means you accept the{" "}
        <Link href="/terms" className="underline decoration-red decoration-2 underline-offset-2">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline decoration-red decoration-2 underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @onelife/web run test -- login`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(site)/(boxed)/login"
git commit -m "feat(web): consent line on the sign-in page"
```

---

### Task 7: Full verification, docs, and changelog

**Files:**
- Modify: `CLAUDE.md` (the "Outstanding, un-verified work" list)
- Modify: `docs/architecture/web-surfaces.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

⚠️ `CLAUDE.md` and `docs/architecture/` have uncommitted changes in the working tree from unrelated
work. **Stage explicit paths only — never `git add -A` at the repo root.**

- [ ] **Step 1: Run the full web suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS. Record the real count; do not claim green without seeing it.

- [ ] **Step 2: Run the full typecheck**

Run: `pnpm turbo run typecheck`
Expected: no errors.

- [ ] **Step 3: Record the on-device check that tests cannot cover**

Add to the "Outstanding, un-verified work" list in `CLAUDE.md`:

```markdown
- The four-link footer row at 320px, and the tab-bar gutter still clearing it in PWA/standalone
  on a notched phone (legal pages). RTL pins `flex-wrap` as a class; only a browser can confirm
  the wrap and the clearance.
```

- [ ] **Step 4: Record the surfaces in the architecture doc**

Add to `docs/architecture/web-surfaces.md`:

```markdown
## Legal pages

- **`/terms` and `/privacy`** ✅ (spec `docs/superpowers/specs/2026-07-29-legal-pages-design.md`):
  two static prose routes under `(site)/(boxed)/`, rendered by one shared `LegalDoc` from typed
  `LegalSection[]` modules in `apps/web/src/content/legal/`. No fetches — the loading/failed/empty
  rule has nothing to apply to.
  **⚠️ Invariants:**
  1. **Both pages print one `EFFECTIVE_DATE` constant.** Two separately-maintained dates would
     drift, and a stale date on a legal page is a claim about when you last told the truth.
  2. **The page tests pin clauses by CONTENT, not by count.** Each asserted string is a disclosure
     or a limitation — the contact address, the no-affiliation disclaimer, tokens having no cash
     value, obituaries being machine-written, the OpenRouter/Anthropic disclosure, Arizona
     governing law, the append-only deletion carve-out. A failure means restore the clause, never
     relax the assertion.
  3. **The AI disclosure is the sharpest omission risk.** `apps/newsdesk` sends the player's
     gamertag and their killer's gamertag to OpenRouter/Anthropic to write the obituary. Nobody
     would guess that; it must stay disclosed as `apps/newsdesk` evolves.
  4. **The deletion promise is bounded by the event log.** Account data goes; lives, deaths, kills,
     positions and obituaries stay, because `events` is append-only and every projection rebuilds
     from it. Do not widen the promise without building the erasure first.
  5. **Section `id`s are stable anchors.** They are how a support reply links straight to a clause;
     renaming one silently breaks every link already sent.
```

- [ ] **Step 5: Write the changelog entry**

Add under the `Unreleased` heading in `CHANGELOG.md`, matching the surrounding style:

```markdown
### Added

- Terms & Conditions (`/terms`) and Privacy Policy (`/privacy`) pages, linked from the footer and
  from a consent line on the sign-in page. The privacy policy discloses session IP/user-agent
  storage, map-coordinate collection, and that obituaries send a player's gamertag to
  OpenRouter/Anthropic; deletion is promised for account data only, with the append-only gameplay
  record explicitly excluded.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/architecture/web-surfaces.md CHANGELOG.md
git commit -m "docs: record the legal pages and their on-device check"
```

- [ ] **Step 7: Open the PR**

Use `keel:finish-work`. The repo's lifecycle is owned by keel — do not hand-roll `gh pr create`.

---

## Before this ships

**`admin@dayzonelife.com` must actually receive mail.** A privacy policy naming a dead address is
worse than one naming none. This is a hosting task outside the repo and blocks release, not
implementation.
