import { readFile } from "node:fs/promises";
import { getDb } from "@onelife/db";
import { parsePayload, ContractError } from "./contract.js";
import { draftArticle, publishArticle, unpublishArticle, spikeArticle, listArticles } from "./store.js";
import { scout } from "./scout.js";

/**
 * The newsroom CLI — THE ONLY WRITE PATH for editorial articles. It exists so a hand-written
 * piece passes the same contract (schema, namespace, Tier-1 voice lint, provenance) every time;
 * a psql INSERT would bypass all four.
 *
 * Errors print one line and exit 1 — the operator is a writer at a terminal, not a stack-trace
 * reader.
 */
const USAGE = `usage: newsroom <command>

  draft <file.json>   validate a payload and store it as a draft (prints the preview URL)
  publish <slug>      draft -> published (prints the live URL)
  unpublish <slug>    published -> draft (the mistake hatch; never writes 'retracted')
  spike <slug>        delete a DRAFT (a published article is never deleted)
  list [--drafts]     list editorial+news articles, newest first
  scout               story tips: the shipped trigger finders + the per-map aggregate digest`;

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) die("DATABASE_URL is not set");
  const siteUrl = (process.env.SITE_URL ?? "https://dayzonelife.com").replace(/\/+$/, "");
  const previewToken = process.env.NEWS_PREVIEW_TOKEN ?? "";

  const { db, sql } = getDb(databaseUrl);
  try {
    switch (cmd) {
      case "draft": {
        if (!arg) die("draft needs a payload file: newsroom draft <file.json>");
        let raw: unknown;
        try {
          raw = JSON.parse(await readFile(arg, "utf8"));
        } catch (e) {
          die(`could not read ${arg}: ${(e as Error).message}`);
        }
        const slug = await draftArticle(db, parsePayload(raw));
        console.log(`drafted: ${slug}`);
        if (previewToken) {
          console.log(`preview: ${siteUrl}/news/${slug}?preview=${previewToken}`);
        } else {
          console.log("WARNING: NEWS_PREVIEW_TOKEN is unset — the draft exists but its preview URL will 404.");
          console.log(`         Set the token (openssl rand -hex 16) and open ${siteUrl}/news/${slug}?preview=<token>`);
        }
        break;
      }
      case "publish": {
        if (!arg) die("publish needs a slug: newsroom publish <slug>");
        const result = await publishArticle(db, arg);
        console.log(result === "noop" ? `already published: ${arg}` : `published: ${siteUrl}/news/${arg}`);
        break;
      }
      case "unpublish": {
        if (!arg) die("unpublish needs a slug: newsroom unpublish <slug>");
        await unpublishArticle(db, arg);
        console.log(`unpublished (back to draft): ${arg}`);
        break;
      }
      case "spike": {
        if (!arg) die("spike needs a slug: newsroom spike <slug>");
        await spikeArticle(db, arg);
        console.log(`spiked: ${arg}`);
        break;
      }
      case "list": {
        const draftsOnly = arg === "--drafts";
        const rows = await listArticles(db, draftsOnly);
        if (!rows.length) {
          console.log(draftsOnly ? "no drafts." : "no articles.");
          break;
        }
        for (const r of rows) {
          const format = (r.facts as { format?: string } | null)?.format ?? "-";
          console.log(`${(r.status ?? "-").padEnd(10)} ${format.padEnd(10)} ${r.slug}  ${r.headline ?? ""}`);
        }
        break;
      }
      case "scout": {
        // Same suppression the shipped exclusions use — the desk honours identical opt-outs.
        const suppressed = (process.env.NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS ?? "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        const report = await scout(db, new Date(), { suppressedGamertags: suppressed });

        console.log("THE STANDING DEAD — open qualified lives gone quiet");
        if (!report.standingDead.length) console.log("  (no tips)");
        for (const t of report.standingDead) {
          console.log(`  ${t.gamertag}  ·  ${t.map}  ·  idle ${t.idleDays}d`);
        }

        console.log("\nTHE LONG FORM — deaths that converged");
        if (!report.longForm.length) console.log("  (no tips)");
        for (const c of report.longForm) {
          console.log(`  ${c.map}  ·  ${c.subjectCount} subjects  ·  ${c.earliestDeathAt.toISOString()}`);
        }

        console.log("\nTHE DIGEST — last 14 days, per map (medians can be moved by one player; state n when small)");
        for (const a of report.aggregates) {
          const median = a.medianLifeMinutes == null ? "-" : `${a.medianLifeMinutes.toFixed(1)}m median life`;
          const single = a.singleSessionPct == null ? "-" : `${a.singleSessionPct.toFixed(0)}% single-session`;
          console.log(`  ${a.map}  ·  ${a.players} players  ·  ${median}  ·  ${single}`);
        }
        break;
      }
      default:
        die(USAGE);
    }
  } catch (e) {
    if (e instanceof ContractError) die(`contract: ${e.message}`);
    die((e as Error).message);
  } finally {
    await sql.end();
  }
}

void main();
