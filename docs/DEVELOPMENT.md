# Developer notes

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the site locally (needs `.env.local`, see `.env.example`) |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (no database needed) |
| `npm run test:db` | Database tests: creates a throwaway database per test file on `TEST_PG_ADMIN_URL` |
| `npm run build` | Production build |
| `npm run migrate:usportvb -- …` | League import (dry run unless `--apply --yes`), see DEPLOYMENT.md |
| `npm run sync:once` | Run one data sync against `DATABASE_URL` |
| `npx tsx scripts/grant-admin.ts --email …` | Make a user league admin |

## Local database for tests

Any PostgreSQL 15+ works. `tests/db/supabase-auth-stub.sql` adds the small parts of Supabase
the migrations need (`auth.users`, `auth.uid()`, the `anon`/`authenticated` roles).

```bash
export TEST_PG_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres
npm run test:db
```

To try the import locally:

```bash
createdb sideout_dev
psql sideout_dev -f tests/db/supabase-auth-stub.sql
for f in supabase/migrations/*.sql; do psql sideout_dev -f "$f"; done
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sideout_dev npm run migrate:usportvb -- --snapshot snapshot.json --players players.json --exclude-team <id> --cutover-week 4
```

## Rules for future changes

- **Database changes go in a new migration file** (`supabase/migrations/<timestamp>_<name>.sql`).
  Never edit a migration that has already been applied to production.
- New tables need `enable row level security`, a read policy, and no insert/update/delete grants
  for `authenticated`. Writes go through a `security definer` function that checks the caller and
  writes to `audit_log`.
- Scoring logic exists twice: the SQL view `v_player_match_points` (authoritative) and
  `src/lib/scoring/engine.ts` (previews/tests). `tests/db/scoring-views.test.ts` checks that they
  agree. Change both together.
- Never commit HAR files, `.env*`, the `reports/` folder, league snapshots, or anything with
  member emails. `.gitignore` covers these.

## Running behind a corporate/sandbox web proxy

Node's built-in `fetch` ignores `HTTPS_PROXY` unless told otherwise. If the import or sync fails
with `fetch failed` / `ENOTFOUND` on a machine that needs a proxy, run it with
`NODE_USE_ENV_PROXY=1`. Vercel does not need this.
