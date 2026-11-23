import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Supabase blocks DELETE and UPDATE statements without a WHERE clause when they run through the
 * app ("DELETE requires a WHERE clause"). Local test databases don't, so check the SQL itself.
 */
describe("migrations", () => {
  it("never delete or update without a where clause", () => {
    const dir = path.join(process.cwd(), "supabase/migrations");
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
      const sql = readFileSync(path.join(dir, f), "utf8").replace(/--[^\n]*/g, "");
      for (const m of sql.matchAll(/\b(delete\s+from|update)\s+[\w."]+[^;]*;/gi)) {
        const stmt = m[0];
        // "insert ... on conflict ... do update set" is an upsert, which is allowed.
        if (/\bdo\s*$/i.test(sql.slice(Math.max(0, m.index! - 8), m.index))) continue;
        // "update of col on table" in trigger definitions isn't an UPDATE statement.
        if (/^update\s+of\b/i.test(stmt) || /^update\s+on\b/i.test(stmt)) continue;
        if (/\bupdate\b/i.test(m[1]!) && !/\bset\b/i.test(stmt)) continue;
        if (!/\bwhere\b/i.test(stmt)) bad.push(`${f}: ${stmt.replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
