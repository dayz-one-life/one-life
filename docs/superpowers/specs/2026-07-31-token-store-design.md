# Token store — selling unban tokens via Stripe Checkout

**Date:** 2026-07-31
**Status:** Approved design, awaiting implementation plan

## Goal

Let players buy unban tokens with real money on the website. The purpose is
cost-offset (server bills), framed as supporting the community — not a
first-class monetization push. Purchases are **uncapped** (no per-ban or
per-period limit, no hold cap): this is a deliberate call, accepted with the
knowledge that it softens the one-life stakes for paying players.

## Decisions (settled during brainstorming)

| Decision | Choice |
| --- | --- |
| Payment rail | Stripe Checkout (hosted page) |
| Packaging | Single price per token (~$3), buyer picks quantity in Checkout |
| Purchase limits | None (uncapped) |
| Eligibility | Verified users only — buyer must hold a `verified` `gamertag_links` row |
| Entry points | Home controls slab ("Your tokens" half) + banned ticket's no-tokens state |
| Dedicated /store page | No |
| Refunds | Manual, in the Stripe dashboard; automated compensating rows are a later add |
| Fulfillment architecture | Ledger-native (Approach A) — no order table, no new worker |

## Architecture

A purchase is fulfilled by inserting rows into the existing append-only
`token_transactions` ledger. The ledger's UNIQUE `idempotency_key` +
`onConflictDoNothing` insert is the exactly-once mechanism; there is no order
state machine. Stripe is the source of truth for payment state; the ledger is
the source of truth for token grants.

### Purchase flow

1. Buyer clicks a buy entry point → web calls `POST /me/tokens/checkout`.
2. API verifies the session user is verified, creates a Stripe Checkout
   Session:
   - the one configured Price (`STRIPE_TOKEN_PRICE_ID`),
   - `adjustable_quantity` enabled, min 1, max 20,
   - `client_reference_id = userId`,
   - success URL `{site}/?checkout={CHECKOUT_SESSION_ID}`, cancel URL `{site}/`.
   Returns the session's redirect URL; web navigates there.
3. Buyer pays on Stripe's hosted page.
4. Fulfillment is one idempotent function, `fulfillPurchase(sessionId)`,
   reached by two independent paths (racing them is harmless):
   - **Webhook:** `POST /stripe/webhook` on `checkout.session.completed`.
   - **Return-trip confirm:** landing back on `/?checkout=...`, web calls
     `POST /me/tokens/checkout/confirm`, which retrieves the session from
     Stripe and fulfills if paid. This shows the buyer their new balance
     immediately even when the webhook is slow.

### Fulfillment (`packages/tokens/src/purchase.ts`)

- `fulfillPurchase` inserts N rows of `delta: +1, kind: 'purchase'`,
  idempotency keys `stripe:{sessionId}:{i}` for i in 1..quantity, using the
  existing conflict-ignoring grant insert. Webhook retries, webhook/confirm
  races, and replays are all no-ops.
- The Stripe SDK is injected (the tokens package takes the retrieved session
  data, not a Stripe client) — the SDK dependency lives in `apps/api` only.
- New `'purchase'` member in the `kind` TS union. **Planning must verify**
  whether `kind` is a pg enum (migration required) or text (no migration);
  it is believed to be text.
- Purchases generate **no notification** — the buyer just watched the
  purchase happen. Planning must confirm the notifier's account generator
  tolerates (ignores) the new kind rather than crashing on it.

### API routes (`apps/api`)

- `POST /me/tokens/checkout` — verified-only; no body (quantity is chosen on
  Stripe's hosted page via `adjustable_quantity`, 1–20). 403 `not_verified`
  for unverified users; 503 when Stripe env is unset.
- `POST /me/tokens/checkout/confirm` — body `{ sessionId }`. Verifies the
  session's `client_reference_id` matches the caller (403 otherwise);
  fulfills if paid; returns `{ granted, paid, balance }`.
- `POST /stripe/webhook` — no auth session; the Stripe signature (verified
  against `STRIPE_WEBHOOK_SECRET`, using the raw request body — the one
  Fastify route that needs raw-body access) is the authentication. 400 on a
  bad signature.

Route errors follow the existing `TokenError.code` → `ERROR_STATUS` pattern
in `apps/api/src/routes/tokens.ts`.

### Web (`apps/web`)

- **Controls slab** (`components/account/controls-slab.tsx`): a
  "Buy tokens — $3 each" action beside the balance in the *Your tokens*
  half. On the `/?checkout=` return: call confirm, refetch the `["tokens"]`
  query, show a brief "N tokens added" note. A failed/slow confirm must NOT
  render as zero or as failure of the purchase — show "payment processing,
  tokens land shortly" (the webhook will catch it). Loading, failed, empty
  and zero remain four different renders.
- **Banned ticket** (`components/player/ticket-spend.tsx`): shipped as "Buy a
  token" shown beneath "Spend 1 token" whenever the store is configured
  (ON) — not gated to a `no-tokens` state as originally scoped here. `TicketSpend`
  is deliberately mountable without a query provider and has no way to know
  the caller's balance, so it cannot distinguish `no-tokens` from
  has-tokens; showing the buy affordance unconditionally when the store is
  on is the simplest correct rendering given that constraint.
- Display price comes from `NEXT_PUBLIC_TOKEN_PRICE_LABEL`; Stripe's Price
  object stays authoritative for what is actually charged.

## Configuration

| Var | App | Meaning |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | api | Stripe API key (test-mode in dev) |
| `STRIPE_WEBHOOK_SECRET` | api | Webhook signature secret |
| `STRIPE_TOKEN_PRICE_ID` | api | The Price for one token |
| `NEXT_PUBLIC_TOKEN_PRICE_LABEL` | web | Display-only price string, e.g. `$3` |

Unset-means-OFF, per house rule: with Stripe env unset the checkout route
returns 503 and the web app hides the buy buttons entirely — the feature is
invisible until configured. Dev/staging use Stripe test-mode keys, which is
the payments equivalent of the workers' dry-run default.

## Error handling & edge cases

- **Webhook replay / double fulfillment:** no-op via idempotency keys.
- **Confirm called with someone else's sessionId:** 403 on
  `client_reference_id` mismatch.
- **Unpaid/expired session confirmed:** no grant; respond with granted 0 and
  payment state so the web can keep showing "processing" or drop the flag.
- **Transient Stripe errors on session retrieval:** propagate (webhook 500s → Stripe retries) rather than reading as missing session; only `resource_missing` errors return null.
- **Delayed-notification payment methods:** `checkout.session.completed` can
  arrive before the buyer has actually paid; `checkout.session.async_payment_succeeded`
  is the event that confirms it later. The webhook honors both event types
  (the handler is already payment-status-driven via `retrieveSession`), so a
  delayed payment method fulfills once it eventually pays instead of being
  silently dropped.
- **User unverified at fulfillment time** (verified at checkout, link revoked
  mid-payment): still fulfill — money was taken, tokens are userId-scoped and
  spendable once re-verified. Eligibility is a checkout-time gate only.
- **Refunds/disputes:** manual in the Stripe dashboard. No compensating
  ledger row is written automatically; a `charge.refunded` handler inserting
  `delta: -N` is an explicit future addition, out of scope here.

## Testing

DB-suite tests (existing `TEST_DATABASE_URL` pattern), Stripe data faked at
the injection seam:

- Fulfilling the same session twice → balance rises by N exactly once.
- Webhook and confirm racing on one session → same.
- Unverified buyer → 403 from checkout.
- Confirm with mismatched `client_reference_id` → 403, no grant.
- Webhook with a bad signature → 400, no grant.
- Quantity math: session with quantity N → N ledger rows, balance +N.
- Unset Stripe env → checkout 503s; web hides buy buttons (RTL: absence).

Browser-only (carried to the outstanding-work list, not closable by RTL):
the full live round trip against Stripe test mode — click buy → hosted
checkout → return → balance bump — and the buy buttons' rendering at 320px
on both entry surfaces.

## Out of scope

- Bundles/discounts, pay-what-you-want, gifting purchases to another player.
- Automated refund handling.
- A dedicated /store route.
- Purchase caps of any kind.
- Notifications for purchases.
