# Facebook setup for crier

One-time setup to let crier post to the DayZ One Life Facebook Page. Prereq: you are an admin
of the Page.

1. **Create the app**: https://developers.facebook.com → My Apps → Create App → type
   "Business" → name it (e.g. "One Life Crier"). No review/publishing needed — the app only
   posts to a Page you admin, which works in Development mode.
2. **Get a short-lived User token**: Tools → Graph API Explorer → select the app → Add
   permissions: `pages_manage_posts`, `pages_read_engagement` → Generate Access Token (log in
   as the Page admin).
3. **Exchange for a long-lived User token** (60 days):
   `curl "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={SHORT_TOKEN}"`
4. **Get the Page ID and a Page token** (Page tokens minted from a long-lived User token do
   not expire):
   `curl "https://graph.facebook.com/v21.0/me/accounts?access_token={LONG_USER_TOKEN}"`
   → the entry for the Page carries `id` (→ `CRIER_FB_PAGE_ID`) and `access_token`
   (→ `CRIER_FB_PAGE_ACCESS_TOKEN`).
5. **Verify without posting**: `curl "https://graph.facebook.com/v21.0/{PAGE_ID}?fields=name&access_token={PAGE_TOKEN}"`
   should return the Page name.
6. Set both env vars on the server and restart crier (dry-run first — see apps/crier/README.md).

If posting ever 400s with an expired-token error, repeat steps 2–4 and revive the poisoned
rows (README "Operations").
