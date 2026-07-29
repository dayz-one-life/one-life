import type { LegalSection } from "@/components/legal/legal-doc";
import { MailTo } from "./mailto";

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
          What is collected falls into three piles: what your sign-in provider tells us when you
          sign in, what your browser tells us while you&rsquo;re here, and what the game servers
          write down while you play. The last is the big one, and it includes where you were
          standing.
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
          You sign in with an account from another service — Discord or Google today, and possibly
          another one later. That provider passes over your display name, your email address, your
          avatar image, and your account ID at that provider. We also store the access and refresh
          tokens it issues, which are what let the site confirm you are still you.
        </p>
        <p>We never see your password there, and we cannot read your messages there.</p>
      </>
    ),
  },
  {
    id: "your-browser",
    heading: "What your browser gives us",
    body: (
      <>
        <p>
          A session cookie, so you stay signed in, and a second cookie that remembers which map you
          were last looking at. See{" "}
          <a className="underline decoration-red decoration-2 underline-offset-2" href="#cookies">
            Cookies
          </a>{" "}
          below for the full list.
        </p>
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
          <li>
            your position on the map, sampled periodically while you are connected — pulled from
            the server&rsquo;s own player-list dump and from anything else it logs
          </li>
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
        <p>
          Nothing you say in chat is parsed, stored as data, or published — the log parser has no
          handling for chat at all. But the server&rsquo;s raw log is kept as-is, so if the server
          ever happens to write a chat line into it, that line sits there unread.
        </p>
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
        <li>
          Notifications about you and your friends — stored so your inbox can show them.
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
            <strong>Your sign-in provider</strong> (Discord or Google today) — handles your sign-in.
          </li>
          <li>
            <strong>Nitrado</strong> — hosts the game servers that write the logs.
          </li>
          <li>
            <strong>Your browser&rsquo;s push service</strong> (Apple, Google or Mozilla, depending
            on your device) — only if you enable notifications, and only to deliver them.
          </li>
          <li>
            <strong>OpenRouter, and the model it currently routes to</strong> — obituaries are
            written by an AI model (right now, Anthropic&rsquo;s Claude), reached through
            OpenRouter. To write one, we send your full gameplay record for this life and your
            earlier ones — your gamertag, your killer&rsquo;s gamertag, map, time survived, cause,
            weapon, distance, and your record going in. Some of what goes over is detail the site
            itself never shows anywhere: how low your health got, and how many close calls you had
            with infected, fire, or other players. We also send the headlines, attributions and
            opening lines of recently published obituaries as style context, which can include
            other players&rsquo; gamertags. Your account, email and IP address are not sent.
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
        Two cookies, both ours, neither used for tracking: the one that keeps you signed in, and one
        that remembers which map you were last looking at. No analytics cookies, no advertising
        cookies, no third-party cookies. There is no consent banner because there is nothing to
        consent to.
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
          Email <MailTo /> from the address on your account, or give me your gamertag and I will
          verify it another way.
        </p>
        <p>
          <strong>Deleted</strong>: your account, your name and email, the tokens your sign-in
          provider issued, every session — and with them the stored IP addresses and user-agents —
          your avatar, your push subscriptions, your friendships, your preferences, your location
          shares, your unban token balance and its history, your referral link, and your gamertag
          link.
        </p>
        <p>
          <strong>Not deleted</strong>: your gameplay record, your obituaries, and any ban history
          recorded against your gamertag. Lives, deaths, kills and positions live in an append-only
          log that every part of this site is rebuilt from; pulling a gamertag out of it would break
          the rebuild the whole system depends on. It is also the premise of the product. Bans are
          keyed to the gamertag, not the account, so they stand on their own the same way. Once your
          account is gone, that record stands with nothing here tying it to you.
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
        believe a child under 13 has an account here, email <MailTo /> and it will be removed.
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
    body: (
      <p>
        <MailTo />. One person reads it.
      </p>
    ),
  },
];
