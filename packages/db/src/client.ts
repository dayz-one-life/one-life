import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export function getDb(url: string) {
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}
export type Database = ReturnType<typeof getDb>["db"];

// The transaction executor drizzle hands `db.transaction(async (tx) => ...)` — a distinct TS
// type from `Database` (it lacks `$client`) even though both expose the same query builders.
// Exported so callers that run steps inside their own transaction (e.g. `deleteAccount`) can
// type a parameter that accepts either, with full query-builder type checking preserved.
export type Tx = Parameters<Database["transaction"]>[0] extends (tx: infer T, ...args: any[]) => any ? T : never;
export type DbOrTx = Database | Tx;
