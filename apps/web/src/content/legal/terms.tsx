import type { LegalSection } from "@/components/legal/legal-doc";
import { MailTo } from "@/content/legal/mailto";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "who-runs-this",
    heading: "Who runs this",
    body: (
      <>
        <p>
          One Life is run by one person, in the United States, as a hobby. There is no company
          behind it. You can reach me at <MailTo />.
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
        You sign in with an account from another service — Discord or Google today, and possibly
        another one later. One account per person. Anything done through your account is treated
        as done by you, so don&rsquo;t share it. If you lose access to that sign-in provider you
        lose access to this one — email me and we&rsquo;ll sort it out.
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
          far, and which map it happened on. That record is public and it is permanent. Deleting
          your account does not remove it.
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
          <MailTo />. You&rsquo;ll get an answer. You may not get a reversal, and I&rsquo;m not
          obliged to explain how I know what I know.
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
