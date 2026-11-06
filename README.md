# Sideout: private OUA women's volleyball fantasy league

A private, mobile-friendly fantasy volleyball app for the VolleyBALLERs league, replacing USportVB
without anyone redrafting.

**Features:** invite-only sign-in · league dashboard · My Team with lineup editor and per-player
locks · head-to-head matchups with live-updating scores · standings with tiebreakers · player
database and profiles with match-by-match stats · match centre · free agency (add/drop) ·
trades (with optional commissioner review and deadline) · versioned scoring with impact preview ·
admin dashboard (settings, scoring, managers, roster corrections, match lock times, playoffs,
sync monitoring, audit log) · automatic stat updates in the cloud.

**Stack:** Next.js 15 + React 19 + TypeScript + Tailwind (Vercel) · Supabase (PostgreSQL, Auth,
Row Level Security).

## Documents

| Read this | For |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | **Step-by-step set-up and go-live** (start here) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works and why, in plain English |
| [docs/PHASE1_SOURCE_REPORT.md](docs/PHASE1_SOURCE_REPORT.md) | What was verified about the USportVB data |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Commands and rules for developers |
| [PROJECT_SPEC.md](PROJECT_SPEC.md) | The original specification |

## Project layout

```
supabase/migrations/   database tables, security rules, league actions, scoring views
src/lib/               scoring engine, league settings, standings, data source, import, sync
src/app/               pages (src/app/(app)/…), server actions (src/app/actions.ts), cron endpoint
scripts/               league import, one-off sync, grant admin
tests/db/              database tests (run against a real PostgreSQL)
```
