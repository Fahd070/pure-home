# Database restore verification

This document covers **verifying that a backup actually restores**, using an isolated
disposable database. It does not cover a real production disaster-recovery restore in
detail — see the warning and high-level procedure at the bottom.

For how backups are created and where they're stored, see `docs/BACKUP-STRATEGY.md`.

## 1. Locate a backup

- **Automated (recommended)**: `github.com/Fahd070/pure-home/actions/workflows/db-backup.yml`
  → open a successful run → **Artifacts** → download `wfm-db-backup-YYYYMMDD-HHMMSS` (a
  `.zip` containing the `.dump` file).
- **Manual**: a file from the local `backups/wfm-backup-*.dump` directory (produced by
  `scripts/backup-database.ps1`).

Both are `pg_dump --format=custom` archives.

## 2. Required PostgreSQL tools

- `pg_restore` (from the `postgresql-client` package; version 15+ recommended, matching
  the disposable database used below)
- Node.js 20 + this repo's `packages/backend` dependencies installed (`npm install` /
  `npm ci`)

## 3. Restore into an isolated database and verify

**Never point this at Supabase, Render, or any production database.** Create a throwaway
local Postgres first, e.g.:

```bash
docker run -d --name wfm-restore-check -p 5555:5432 \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=wfm_restore_test postgres:15
```

Then, from `packages/backend`:

```bash
RESTORE_TEST_DATABASE_URL="postgresql://postgres:test@localhost:5555/wfm_restore_test" \
  npm run backup:verify -- /path/to/wfm-backup-YYYYMMDD-HHMMSS.dump
```

Clean up afterward: `docker rm -f wfm-restore-check`.

### What this command does

1. Refuses to run if `RESTORE_TEST_DATABASE_URL` looks like Supabase/Render/any
   non-localhost host, or if the database name doesn't contain `test` — this is a
   technical check (`tests/helpers/dbSafety.ts`), not just a warning. A typo cannot
   point a restore at production.
2. Confirms the backup file exists and is non-empty.
3. Runs `pg_restore --list` to confirm the archive itself is valid before touching any
   database.
4. Restores it into the target (must be an empty database — no `--clean`, so any
   restore error is unambiguous).
5. Confirms the restored database is queryable, that every table declared in
   `prisma/schema.prisma` is present, prints row counts (table + count only, never row
   contents), confirms foreign-key constraints survived, and runs one read-only
   aggregate sanity join.

## 4. Safety warning

- This command only ever **writes** to the disposable database named in
  `RESTORE_TEST_DATABASE_URL`. It never connects to production.
- The verification logs print table names and counts only — never customer names,
  phone numbers, message contents, or access codes. Do not modify the script to print
  row contents; that would leak real customer data into CI logs.

## 5. Interpreting the result

- **Exit code 0 / "SUCCESS: backup restored into an isolated database and verified."**
  — the backup is genuinely restorable and structurally sound.
- **Any non-zero exit** — the backup could not be verified. The printed `[backup-verify]
  FAILED: ...` line states exactly which check failed (missing env var, unsafe target,
  missing/corrupt archive, restore error, missing table, no foreign keys, unqueryable
  database). Do not treat a failed run as "probably fine" — treat it as an unverified
  backup and investigate the specific failure before relying on it.

## 6. Recurring automated verification

`.github/workflows/db-backup.yml` restores every backup it creates into a disposable
Postgres service container in the same workflow run, immediately after creating it, and
fails the whole job (same red-X / failure-email behavior already documented in
`docs/BACKUP-STRATEGY.md`) if that restore or its verification fails. No separate setup
is required — this runs automatically on every scheduled or manually-triggered backup.

## 7. Production recovery — high-level procedure only

**Do not blindly restore a backup over the live production database.** This document
does not walk through that operation, and `scripts/restore-backup.ps1` (which can write
to production) requires typing `YES` at an interactive prompt specifically so it is
never run unattended.

A real disaster-recovery restore requires, in order:

1. **Maintenance / write freeze** — stop the backend (or otherwise ensure no writes are
   happening) before touching anything, so the restore target isn't a moving target.
2. **Verified backup selection** — pick the specific backup artifact, and confirm its
   timestamp is acceptable given how much data loss (everything after that timestamp)
   is acceptable.
3. **Isolated restore validation first** — run the verification command in this
   document against that exact backup before it ever touches production, using a fresh
   disposable database, exactly as described above.
4. **Explicit operator approval** — a human who understands the data-loss window
   explicitly decides to proceed. This is not a step to automate.
5. **Controlled production restore** — only then, using `scripts/restore-backup.ps1`
   (or the equivalent `pg_restore` invocation) against the real `SUPABASE_DIRECT_URL`,
   with the existing confirmation prompt intact.

After any real production restore: verify `GET https://wfm-system.onrender.com/health`
returns `database: connected`, log into each department and spot-check records, and
record the restore event (what was restored, when, and why) in the audit trail.
