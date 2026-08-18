import { describe, it, expect, afterAll } from "vitest";
import { APP_TABLES, getTestDb } from "@onelife/test-support";

const { sql } = getTestDb();

afterAll(async () => { await sql.end(); });

/**
 * ⚠️ Every DB-backed test file in this repo shares ONE Postgres database. globalSetup truncates
 * APP_TABLES with `cascade`, so a table is cleaned either by being listed or by a listed table's
 * foreign key cascading into it. A table with NO foreign key has neither — an interrupted run
 * leaves its rows behind forever.
 *
 * `blocked_avatar_hashes` is exactly that case (it deliberately has no FK, so a ban survives the
 * uploader deleting their account), and a leftover ban row silently 404s an unrelated avatar test
 * in some later file. This test fails the moment another such table is added and not listed.
 */
describe("test database truncation list", () => {
  it("lists every table that no foreign key cascades into", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select t.table_name
      from information_schema.tables t
      where t.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and t.table_name <> '__drizzle_migrations'
        and not exists (
          select 1 from information_schema.table_constraints c
          where c.table_schema = 'public'
            and c.table_name = t.table_name
            and c.constraint_type = 'FOREIGN KEY'
        )
      order by t.table_name
    `;
    const unreachable = rows.map((r) => r.table_name);
    expect(unreachable).toContain("blocked_avatar_hashes");
    const missing = unreachable.filter((t) => !APP_TABLES.includes(t));
    expect(missing).toEqual([]);
  });
});
