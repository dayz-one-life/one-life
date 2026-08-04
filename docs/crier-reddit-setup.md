# Reddit setup for crier

One-time setup to let crier post obituaries to r/dayzonelife as link posts. Prereq: the posting
account may submit to the subreddit (moderator or approved submitter).

**Use an established account.** Reddit's spam heuristics are unkind to a brand-new account
posting links to a single domain. The account in use is 15 years old with 10k+ karma, which is
why this is not a live concern here — do not swap in a fresh one without expecting filtered posts.

1. **Register the app**: https://www.reddit.com/prefs/apps → "create another app…" → type
   **web app** → set the redirect URI to `http://localhost:8080/callback` (it only has to be a URL
   you can catch once, on your own machine). You get a **client id** (under the app name) and a
   **client secret**.

2. **Mint a refresh token.** Bearer tokens last one hour; the durable credential is a refresh
   token, and the ONLY way to get one is the `authorization_code` flow with `duration=permanent`.
   (The username/password grant is not used here on purpose — it breaks outright if the account
   has 2FA enabled, and turning 2FA off on an account that moderates the subreddit is the worse
   trade.)

   a. Open this in a browser, logged in as the posting account:

      https://www.reddit.com/api/v1/authorize?client_id={CLIENT_ID}&response_type=code&state=x&redirect_uri=http://localhost:8080/callback&duration=permanent&scope=submit

   b. Approve. You land on the redirect URI with `?code=…` in the query string (the page itself
      failing to load is fine — you only need the code, and it is single-use and short-lived).

   c. Exchange it. Prefix with a space so it stays out of shell history (with
      `HISTCONTROL=ignorespace`), and run it on your own machine, not the server:

      ` curl -u "{CLIENT_ID}:{CLIENT_SECRET}" -A "onelife-crier-setup/1.0" -d "grant_type=authorization_code&code={CODE}&redirect_uri=http://localhost:8080/callback" https://www.reddit.com/api/v1/access_token`

      The response carries `refresh_token` → `CRIER_REDDIT_REFRESH_TOKEN`. It does not expire.

3. **Verify without posting**:

   ` curl -u "{CLIENT_ID}:{CLIENT_SECRET}" -A "onelife-crier-setup/1.0" -d "grant_type=refresh_token&refresh_token={REFRESH_TOKEN}" https://www.reddit.com/api/v1/access_token`

   then, with the `access_token` it returns:

   ` curl -H "Authorization: Bearer {ACCESS_TOKEN}" -A "onelife-crier-setup/1.0" https://oauth.reddit.com/api/v1/me`

   should return the posting account's name.

4. **Set the env vars** on the server and restart crier:
   `CRIER_REDDIT_CLIENT_ID`, `CRIER_REDDIT_CLIENT_SECRET`, `CRIER_REDDIT_REFRESH_TOKEN`,
   `CRIER_REDDIT_SUBREDDIT=dayzonelife`. All four or the channel stays off.

5. **Roll out dry-run first** — see `apps/crier/README.md`. Consider pointing
   `CRIER_REDDIT_SUBREDDIT` at a private test subreddit for the first live post, to confirm the
   OG card unfurls and the flair rules pass before anything reaches r/dayzonelife.

## Flair

If the subreddit requires post flair, submissions fail with `SUBMIT_VALIDATION_FLAIR_REQUIRED`.
Get the flair's template id from
`https://oauth.reddit.com/r/{SUB}/api/link_flair_v2` (same bearer token) and set
`CRIER_REDDIT_FLAIR_ID`.

## Rate cap

`CRIER_REDDIT_MIN_INTERVAL_SECONDS` (default 600) throttles this channel alone. Reddit dislikes
a burst of same-domain links far more than Discord or Facebook do. Deferred rows are **not**
failures — they burn no attempts and are picked up on a later tick — and appear in the log as
`rate cap: deferred` plus a non-zero `deferred` count on the tick summary.

## When a post is rejected

⚠️ Reddit reports most rejections as **HTTP 200 with the error inside the body**, so failures
here look like ordinary recorded failures with a `last_error` such as
`reddit submit rejected: [["RATELIMIT","you are doing that too much"]]`. Check `last_error` in
`syndications`, not the HTTP status. Common ones: `RATELIMIT` (wait, or raise the interval),
`SUBREDDIT_NOEXIST` (typo, or the `r/` prefix left on), `SUBMIT_VALIDATION_FLAIR_REQUIRED` (see
above), and a silent shadowban (the post 200s and returns no errors but is invisible when logged
out — check the profile in a private window).

Unlike Facebook, the credential does not expire, so there is no routine token-rotation step.
