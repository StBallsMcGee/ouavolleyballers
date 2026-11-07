# Deployment & go-live guide

This guide takes you from nothing to a live league, step by step. No programming is needed,
only copying and pasting. Expect about 1–2 hours the first time.

You will create two free accounts:

| Service | What it does for us | Cost for a 16-person league |
|---|---|---|
| **Supabase** (supabase.com) | Database, logins, password-reset emails | Free tier |
| **Vercel** (vercel.com) | Runs the website | Free (Hobby) tier |

Both run in the cloud, so **your laptop can be off**.

> ⚠️ **Make the GitHub repository private first** (GitHub → the repository → Settings → General →
> Danger Zone → Change visibility → Private). No league data is stored in the code, but a private
> repository is the right setting for a private league. Vercel works the same with private repositories.

---

## 1. Create the Supabase project

1. Sign up at supabase.com and click **New project**.
2. Name: `sideout`. Region: **Canada (Central)**. Choose a strong database password and save it in
   a password manager. You'll need it in step 4.
3. Wait for the project to finish setting up (about 2 minutes).

### 1a. Create the database tables

1. In Supabase, open **SQL Editor** → **New query**.
2. Open `supabase/migrations/20261106000100_schema.sql` from this repository, copy **everything**,
   paste it into the editor and click **Run**. It should say "Success. No rows returned".
3. Do the same with `supabase/migrations/20261106000200_logic.sql`.

(Developers can instead run `supabase db push` with the Supabase CLI.)

### 1b. Lock down sign-ups (important for privacy)

**Authentication → Sign In / Providers**
- **Email**: enabled.
- **Allow new users to sign up: OFF.** Only people you invite can get an account.

**Authentication → URL Configuration**
- **Site URL**: your website address from step 2 (for example `https://sideout-volleyballers.vercel.app`).
  You can come back and fill this in after step 2.
- **Redirect URLs**: add `https://YOUR-SITE/auth/callback`.

**Authentication → Emails → SMTP settings** (recommended before inviting everyone)
- Supabase's built-in email sender only sends a few emails per hour. To invite 16 people
  comfortably, connect a free email service such as Resend or Brevo (their sign-up walks you
  through it). Without it, invite managers a few at a time.

### 1c. Collect your keys

**Project Settings → API**: copy the **Project URL**, the **anon public** key and the
**service_role** key.
**Project Settings → Database → Connection string → Transaction pooler**: copy the URI and
replace `[YOUR-PASSWORD]` with your database password.

Keep these private. The service_role key and database URI give full access to the database.

---

## 2. Put the website on Vercel

1. Sign up at vercel.com with your GitHub account.
2. **Add New → Project →** import `ouavolleyballers`.
3. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from 1c |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `DATABASE_URL` | Transaction pooler URI (with your password) |
| `CRON_SECRET` | a long random string. Generate one at 1password.com/password-generator (40+ characters, letters and numbers only) |
| `NEXT_PUBLIC_SITE_URL` | your Vercel address, e.g. `https://sideout-volleyballers.vercel.app` |
| `USPORTVB_API_BASE` | `https://relevant-benni-volleyball-app-71b883ac.koyeb.app` |
| `SOURCE_USER_AGENT` | `SideoutFantasy/1.0 (VolleyBALLERs private league)` |

4. Click **Deploy**. When it's done, open the address and you should see the Sideout sign-in page.
5. Go back to Supabase step 1b and fill in the Site URL and Redirect URL.

The branch with this work is `claude/dreamy-carson-3qfvez`. Merge it into your main branch on
GitHub (or select that branch in Vercel → Settings → Git) so Vercel deploys it.

---

## 3. Automatic updates (so stats update with your laptop off)

The website has a protected address, `/api/cron/sync`, that downloads the latest statistics,
updates matches and finalises weekly matchups. Something in the cloud needs to call it regularly.

**A. Vercel (already set up):** `vercel.json` calls it once a day at 09:17 UTC. On Vercel's
free plan, once a day is the maximum, so we add B for game nights.

**B. Supabase scheduler (recommended):** every 30 minutes in the evening (Toronto time), plus
twice in the daytime. In Supabase:

1. **Database → Extensions**: enable **pg_cron** and **pg_net**.
2. **SQL Editor**, run this once (replace the two placeholders):

```sql
select vault.create_secret('PASTE-YOUR-CRON_SECRET-HERE', 'sideout_cron_secret');

select cron.schedule('sideout-sync-evenings', '*/30 21-23,0-5 * * *', $$
  select net.http_get(
    url := 'https://YOUR-SITE/api/cron/sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'sideout_cron_secret')),
    timeout_milliseconds := 60000);
$$);

select cron.schedule('sideout-sync-daytime', '7 14,18 * * *', $$
  select net.http_get(
    url := 'https://YOUR-SITE/api/cron/sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'sideout_cron_secret')),
    timeout_milliseconds := 60000);
$$);
```

(Times are UTC. 21:00–05:59 UTC is roughly 4 pm–1 am in Toronto.) Each run downloads one file
of about 1.3 MB from USportVB. That's about 22 requests a day, well within what the USportVB
developer agreed to.

You can check it's working on the **Admin** page under **Data sync**, which shows the last
successful run, the last attempt and any errors. **Sync now** runs one immediately.

---

## 4. Import the league

> **Done on 6 Nov 2026** through the website's protected import endpoint (`/api/admin/import`), which runs
> inside Vercel with the keys already stored there. Before activating, use **Admin → Import → Preview refresh /
> Apply refresh** to bring over anything that changed on USportVB since then. The command-line method below
> remains available for developers.

The import is run from a computer with this repository (a developer, or Claude Code, can do it).
It needs Node.js 22 and the `DATABASE_URL` from step 1c.

```bash
npm ci
```

**Step 1: dry run (changes nothing):**

```bash
DATABASE_URL="postgresql://..." npm run migrate:usportvb -- --live --league <LEAGUE_ID> --exclude-team <G_GOAT_TEAM_ID> --cutover-week 4
```

- `--exclude-team`: the empty "G GOAT" team, which you decided not to bring over.
- `--cutover-week 4`: weeks 1–3 keep USportVB's results exactly; Sideout scores week 4 onward.
- Optional `--managers managers.csv`: pre-registers each manager's email so their team is
  linked to them automatically when they first sign in. A template with your team IDs is in the
  private files you were given (`managers_template.csv`). Fill in the email column.

The tool prints a report and saves it in `reports/`. Read it: team, manager, roster and scoring
counts, plus every warning. **Nothing is saved during a dry run**, and the tool proves the import
can run twice without duplicating anything.

**Step 2: apply** (only after you're happy with the dry-run report):

```bash
DATABASE_URL="postgresql://..." npm run migrate:usportvb -- --live --league <LEAGUE_ID> --exclude-team <G_GOAT_TEAM_ID> --cutover-week 4 --apply --yes
```

Before applying, take a backup: Supabase → **Database → Backups**. A brand-new project has
nothing to lose, but get into the habit.

---

## 5. Make yourself the administrator

1. Supabase → **Authentication → Users → Add user → Send invitation** to your own email
   (or create the user with a password).
2. Accept the email and set a password on the Sideout site.
3. Run (replace the email, and the team ID of your own team "GenEVIL Hoowiseman"):

```bash
DATABASE_URL="postgresql://..." npx tsx scripts/grant-admin.ts --email you@example.com --team <YOUR_TEAM_ID>
```

You'll now see **Admin** in the menu.

---

## 6. Invite the managers

**Easiest: the invite link.** Run `supabase/migrations/20261107000200_join_links.sql` once in
the Supabase SQL editor. Then **Admin → Teams & managers → Invite link → Text / share link**
and send it to the group chat. Each manager opens it, enters their name, email and a password,
and taps their team. First come, first served; a team already claimed can't be taken. If someone
picks the wrong team, open that team below (**Manage → Unassign**), then they can pick again.
**Make a new link** stops the old one working (use it once everyone has joined).

**Or by email**: enter each manager's email and name, keep **email invite** ticked and click
**Invite**. They get an email, choose a password, and their team is automatically linked to
them. The status column shows Not invited → Invited → Claimed.

---

## 7. Go live

1. **Admin → League settings**: check the roster (3 OH, 2 M, 1 L, 1 S, 1 UTIL, 11 total), free
   agency ON, trades ON. Choose whether trades need your approval, and set a deadline if you want one.
2. **Admin → Scoring**: check the nine values match USportVB.
3. **Admin → Overview → Activate league.** This also stops the import tool from running again,
   so it can never overwrite managers' changes.
4. Tell everyone that USportVB is retired for this league. Lineups, adds, drops and trades
   happen on Sideout from now on.

### Suggested timeline for this weekend's switchover

| When | What |
|---|---|
| Before Sunday | Steps 1–3 and 5 (set-up, no league data yet). Invite yourself and test signing in. |
| **Monday 9 Nov, morning** (after USportVB has recorded week 3) | Step 4: dry run, review, apply. The import brings over everyone's lineups exactly as they are on USportVB at that moment. |
| Monday 9 Nov | Step 6: invite managers. Step 7: activate. |
| Before the first week 4 match | Managers set their week 4 lineups on Sideout. |

If USportVB hasn't recorded week 3 results by Monday, the dry-run report will say week 3
matchups would be imported as "no contest". In that case **wait and re-run the dry run** before
applying.

---

## 8. Playoffs

The playoff format on USportVB could not be verified. When you're ready: **Admin → League
settings → Playoffs**. Turn it on, then choose the number of teams and the first playoff week
(weeks 11–13 have no regular-season matchups). Then **Admin → Matchups & playoffs** shows
the seeded bracket for you to create, one round at a time.

## 9. Backups and recovery

- Supabase takes a daily backup automatically (kept 7 days on the free plan; Pro adds
  point-in-time recovery).
- Every change made in the app is in the **Audit log** (Admin → Audit log), including who made it,
  what it was before and after, and when.
- Every import keeps a copy of the source data (with the league password removed) in the
  `source_snapshots` table.
