import { describe, it, expect, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";

const { sql } = getTestDb();
afterAll(async () => { await sql.end(); });

async function indexDef(name: string): Promise<string | null> {
  const rows = await sql<{ indexdef: string }[]>`
    select indexdef from pg_indexes where schemaname = 'public' and indexname = ${name}`;
  return rows[0]?.indexdef ?? null;
}

async function columnType(table: string, column: string): Promise<string | null> {
  const rows = await sql<{ data_type: string }[]>`
    select data_type from information_schema.columns
     where table_schema = 'public' and table_name = ${table} and column_name = ${column}`;
  return rows[0]?.data_type ?? null;
}

describe("migration 0014 — articles natural_key + body_blocks + partial life index", () => {
  it("adds articles.natural_key as text", async () => {
    expect(await columnType("articles", "natural_key")).toBe("text");
  });

  it("adds articles.body_blocks as jsonb", async () => {
    expect(await columnType("articles", "body_blocks")).toBe("jsonb");
  });

  it("adds a unique index on natural_key, partial on NOT NULL", async () => {
    const def = await indexDef("articles_natural_key_uniq");
    expect(def).toBeTruthy();
    expect(def!).toMatch(/^CREATE UNIQUE INDEX/);
    expect(def!).toMatch(/natural_key IS NOT NULL/);
  });

  it("makes the life natural-key unique index PARTIAL on the two life-keyed kinds", async () => {
    const def = await indexDef("articles_kind_server_gamertag_life_uniq");
    expect(def).toBeTruthy();
    expect(def!).toMatch(/^CREATE UNIQUE INDEX/);
    // Postgres normalizes `kind IN ('a','b')` to `kind = ANY (ARRAY['a'::text, 'b'::text])`.
    expect(def!).toMatch(/WHERE/);
    expect(def!).toMatch(/obituary/);
    expect(def!).toMatch(/birth_notice/);
    // The four indexed columns must be unchanged.
    expect(def!).toMatch(/\(kind, server_id, gamertag, life_started_at\)/);
  });

  it("adds the (kind, status, created_at) feed index", async () => {
    const def = await indexDef("articles_kind_status_created_idx");
    expect(def).toBeTruthy();
    expect(def!).toMatch(/\(kind, status, created_at\)/);
  });
});
