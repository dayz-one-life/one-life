-- Who lifted a ban (death-verdict plan step 9): 'token' when a player spent an unban token
-- (`redeem`), 'operator' when `pnpm --filter @onelife/enforcer run unqualified-bans -- --lift`
-- lifted a ban whose life no longer qualifies. NULL on every older row, which reads as 'token':
-- until now a token was the only way to lift one. Additive only.
ALTER TABLE "bans" ADD COLUMN IF NOT EXISTS "lift_reason" text;
