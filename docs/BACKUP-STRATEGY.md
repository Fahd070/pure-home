# Pure Home — Backup & Recovery Strategy

Version 1.4.0 | Database: Supabase (PostgreSQL) | Backup runner: GitHub Actions

---

## What Actually Runs (Implementation Summary)

| Layer | Type | Automated? | Where stored | Retention |
|---|---|---|---|---|
| **GitHub Actions** | `pg_dump` (custom format, compressed) | Yes — daily 02:00 UTC | GitHub Actions artifacts | **90 days** |
| **Supabase built-in** | Platform snapshot | Yes — daily ~00:00 UTC | Supabase internal (inaccessible via API on free tier) | 7 days |
| **Manual / on-demand** | `pg_dump` via PowerShell script | No — must be triggered | Local `backups/` directory | 30 most recent |

The **primary automated backup** is the GitHub Actions workflow. The Supabase platform backup is a
secondary safety net but cannot be downloaded or scripted on the free tier — it only supports point-
and-click restore from the dashboard.

---

## GitHub Actions Backup (Primary)

### How it works

File: `.github/workflows/db-backup.yml`

1. Runs daily at **02:00 UTC** via GitHub Actions `schedule` cron
2. Installs `postgresql-client` on an Ubuntu runner
3. Calls `pg_dump` against the **direct Supabase connection** (port 5432) using the
   `SUPABASE_DIRECT_URL` secret — NOT the pgBouncer pooler URL
4. Produces a compressed custom-format dump (`.dump`)
5. Verifies integrity with `pg_restore --list` — fails if object count < 5
6. Uploads as a named artifact (`wfm-db-backup-YYYYMMDD-HHMMSS`) with **90-day retention**
7. Writes a summary table to the workflow run page

### What is backed up

`pg_dump --no-acl --no-owner` captures all PostgreSQL tables including:

| Table | Contents |
|---|---|
| `users` | All admin / scheduling / technician accounts |
| `customers` | Customer records and addresses |
| `appointments` | All scheduled and historical appointments |
| `maintenance_tasks` | Task status, notes, completion data |
| `task_history` | Full status change history |
| `postponement_records` | Postponement reasons and new dates |
| `notifications` | Maintenance reminders per user |
| `audit_logs` | Full audit trail of all system actions |
| `event_logs` | Domain event history |
| `direct_messages` | Inter-department messages |
| `system_configs` | Department access codes |
| `user_settings` | Per-user display preferences |

### Failure detection

GitHub Actions **automatically sends an email** to the repository owner when a scheduled
workflow fails. You will receive a "GitHub Actions: Workflow run failed" email if:
- `pg_dump` exits non-zero (DB unreachable, bad credentials)
- The backup file is empty
- `pg_restore --list` fails (corrupt dump)
- The artifact upload fails

To also monitor via the GitHub UI: go to
`https://github.com/Fahd070/wfm-system/actions/workflows/db-backup.yml`
and verify the last run shows a green checkmark.

### Where to find backup artifacts

1. Go to: `https://github.com/Fahad070/wfm-system/actions/workflows/db-backup.yml`
2. Click any workflow run
3. Scroll to the **Artifacts** section
4. Download `wfm-db-backup-YYYYMMDD-HHMMSS` (a `.zip` containing the `.dump` file)

---

## Required One-Time Setup (Admin Action Required)

The GitHub Actions workflow requires one secret to be added to the repository.

**Steps:**
1. Go to `https://github.com/Fahad070/wfm-system/settings/secrets/actions`
2. Click **New repository secret**
3. Name: `SUPABASE_DIRECT_URL`
4. Value: the **direct** (non-pooler) connection string from Supabase:
   - Supabase Dashboard → Project Settings → Database → Connection String → **URI mode**
   - It looks like: `postgresql://postgres:PASSWORD@db.PROJECTREF.supabase.co:5432/postgres`
   - Port must be **5432** — NOT 6543 (the pooler port that Render uses)
5. Click **Add secret**

After adding the secret, trigger a test run:
- Go to the workflow page → click **Run workflow** → **Run workflow**
- Verify it completes with a green checkmark and the artifact appears

---

## Manual Backup (On-Demand)

For backups before a major change or deployment:

```powershell
# From the project root:
.\scripts\backup-database.ps1 -DirectUrl "postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"

# Or set the env var once, then run without flags:
$env:SUPABASE_DIRECT_URL = "postgresql://..."
.\scripts\backup-database.ps1
```

Backups are saved to `backups/wfm-backup-YYYYMMDD-HHMMSS.dump`. The last 30 are kept automatically.

---

## Restore Procedure

### Step 1 — Obtain the backup file

**From GitHub Actions (recommended):**
1. Go to: `https://github.com/Fahad070/wfm-system/actions/workflows/db-backup.yml`
2. Click the most recent successful run
3. Under Artifacts, download `wfm-db-backup-YYYYMMDD-HHMMSS`
4. Extract the `.zip` to get the `.dump` file

**From local backups:**
- Use a file from `backups/wfm-backup-*.dump`

**From Supabase built-in backup (dashboard restore only):**
- Supabase Dashboard → Project Settings → Backups → select date → Restore
- This method does not use the scripts below

### Step 2 — Run the restore script

```powershell
.\scripts\restore-backup.ps1 -BackupFile "wfm-backup-20260608-020000.dump"
```

The script will:
1. Verify the dump is readable (`pg_restore --list`)
2. Show what will be overwritten and ask for confirmation (`YES`)
3. Run `pg_restore --clean --if-exists` to overwrite all tables
4. Print next-step verification instructions

### Step 3 — Verify

```
GET https://wfm-system.onrender.com/health
Expected: { "status": "ok", "database": "connected", "dbResponseMs": <number> }
```

Then log into each department and spot-check critical records.

---

## Supabase Built-In Backup (Secondary)

Supabase runs its own daily snapshots independently of this project:

- **Free tier:** Daily snapshots, 7-day retention
- **Pro tier:** Point-in-Time Recovery (PITR) to any second within retention window
- **Access:** Supabase Dashboard → Project Settings → Backups (dashboard-only on free tier)

This is a useful last resort when the database is paused or the GitHub Actions secret is not yet
configured. It requires no action to enable — it exists by default.

> Verify your Supabase plan's backup coverage at:
> Supabase Dashboard → Project Settings → Backups

---

## Backup Schedule Summary

| Backup | Time | Frequency | Retention | Stored At | Automated |
|---|---|---|---|---|---|
| GitHub Actions pg_dump | 02:00 UTC | Daily | 90 days | GitHub artifacts | Yes |
| Supabase platform snapshot | ~00:00 UTC | Daily | 7 days (free) | Supabase internal | Yes |
| Manual pg_dump | On demand | — | 30 most recent | Local `backups/` | No |

---

## Health Check Monitoring

The backend exposes a health endpoint used by Render for uptime monitoring:

```
GET https://wfm-system.onrender.com/health
```

**Healthy:**
```json
{
  "status": "ok",
  "database": "connected",
  "dbResponseMs": 42,
  "uptimeSeconds": 18432,
  "timestamp": "2026-06-08T10:00:00.000Z"
}
```

**Degraded (DB unreachable):**
```json
{
  "status": "degraded",
  "database": "disconnected",
  "uptimeSeconds": 18432,
  "timestamp": "2026-06-08T10:00:00.000Z"
}
```

Alert if `dbResponseMs` is consistently above 500 ms.

Set up an external uptime monitor (UptimeRobot free tier) to ping `/health` every 5 minutes
and alert on failure. This catches Supabase pauses before users notice.

---

## Emergency Recovery Checklist

- [ ] Check Render dashboard — is the service running?
- [ ] Check `GET /health` — does it return `database: connected`?
- [ ] Check Supabase dashboard — is the project paused or over quota?
- [ ] Download the latest GitHub Actions artifact for the backup file
- [ ] Run `.\scripts\restore-backup.ps1 -BackupFile <path>`
- [ ] Verify health endpoint and log into each department
- [ ] If GitHub Actions backup is unavailable, use Supabase dashboard restore (7-day window)

---

## What Is NOT Backed Up

- The Render backend process — rebuilt from GitHub on each deploy
- Electron installer — rebuild with `npm run build` in `packages/unified-app`
- Render environment variables — document and store separately (use `.env.example` as reference)
