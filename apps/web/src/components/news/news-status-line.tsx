import Link from "next/link";
import type { NewsSubjectStatus } from "@/lib/types";
import { newsUpdateDate } from "@/lib/news-format";
import { obituaryHref } from "@/lib/obituary-format";

/**
 * Spec §4.1.3. A Standing Dead feature is the only thing the paper prints that its subject can
 * falsify by acting. The prose above it is frozen at publication; THIS line is computed at request
 * time, so the page corrects itself the moment the subject reappears — or dies.
 *
 * Mirrors the "still drawing breath" line the Fresh Spawns interior already ships.
 */
export function NewsStatusLine({ status }: { status: NewsSubjectStatus }) {
  if (status.kind === "idle") {
    const d = status.idleDaysAtPublication;
    return (
      <p className="mt-5 border-l-[3px] border-hairline pl-3 font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
        As of publication, {d} day{d === 1 ? "" : "s"} without a sighting.
      </p>
    );
  }

  if (status.kind === "returned") {
    return (
      <p className="mt-5 border-l-[3px] border-blue pl-3 font-mono text-[11px] uppercase tracking-[.06em] text-blue">
        Update: subject was seen again on {newsUpdateDate(status.seenAt)}. This filing stands as a record of the gap, not of a fate.
      </p>
    );
  }

  return (
    <p className="mt-5 border-l-[3px] border-red pl-3 font-mono text-[11px] uppercase tracking-[.06em] text-red">
      Update: subject has since died, {newsUpdateDate(status.diedAt)}.
      {status.obituarySlug ? (
        <>
          {" "}
          <Link href={obituaryHref(status.obituarySlug)} className="font-bold underline">
            Read the obituary
          </Link>
        </>
      ) : null}
    </p>
  );
}
