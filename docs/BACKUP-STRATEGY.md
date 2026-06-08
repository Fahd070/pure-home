# WFM System — Backup & Recovery Strategy

Version 1.4.0 | Database: Supabase (PostgreSQL) | Backend: Render

---

## Overview

The WFM System database is hosted on Supabase. All data resides in PostgreSQL. This document covers
automated backup availability, manual backup procedures, and step-by-step restore instructions.

No application downtime is required for any backup or restore operation.

---

## Automated Backups (Supabase Built-In)

### Free Tier
- **Daily backups** retained for **7 days**
- Backups run automatically at approximately 00:00 UTC each day
- Access: Supabase Dashboard → Your Project → Settings → Backups

### Pro / Team Tier
- **Point-in-Time Recovery (PITR)** — restore to any second within the retention window
- Retention: 7 days (Pro), 14 days (Team), 30 days (Enterprise)
- No manual intervention required

> Verify your plan's backup coverage in the Supabase dashboard before relying on automated backups.

---

## Manual Backup (pg_dump)

Run this from any machine that has PostgreSQL client tools installed.
Use the **direct connection string** (not the pooler URL) for pg_dump.

```bash
# 1. Get the direct connection string from:
#    Supabase Dashboard → Project Settings → Database → Connection String → URI mode
#    It looks like: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres

# 2. Run pg_dump
pg_dump "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  --format=custom \
  --no-acl \
  --no-owner \
  --file="wfm-backup-$(date +%Y%m%d-%H%M%S).dump"

# 3. Verify the backup file is non-empty
ls -lh wfm-backup-*.dump
```

**Windows (PowerShell):**
```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" `
  "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" `
  --format=custom --no-acl --no-owner `
  --file="wfm-backup-$ts.dump"
```

Store the `.dump` file in a safe location (external drive, cloud storage, etc.).

---

## Restore Procedure

### Restore from Supabase Dashboard (automated backup)

1. Go to Supabase Dashboard → Your Project → Settings → Backups
2. Select the backup date you want to restore
3. Click **Restore** and confirm
4. Wait for the restore to complete (5–15 minutes for small databases)
5. The backend on Render will automatically reconnect after restore

### Restore from pg_dump file

```bash
# Drop and recreate the database schema (Supabase-specific)
# WARNING: This permanently destroys all current data.

pg_restore \
  --dbname="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  --no-acl \
  --no-owner \
  --clean \
  --if-exists \
  wfm-backup-YYYYMMDD-HHMMSS.dump
```

After restore:
1. Verify the backend health check: `GET https://wfm-system.onrender.com/health`
2. Check that `database: "connected"` is returned
3. Log into each department and verify data is present

---

## Health Check Monitoring

The backend exposes a health endpoint used by Render for uptime monitoring:

```
GET https://wfm-system.onrender.com/health
```

**Healthy response:**
```json
{
  "status": "ok",
  "database": "connected",
  "dbResponseMs": 42,
  "uptimeSeconds": 18432,
  "timestamp": "2026-06-08T10:00:00.000Z"
}
```

**Degraded response (DB unreachable):**
```json
{
  "status": "degraded",
  "database": "disconnected",
  "uptimeSeconds": 18432,
  "timestamp": "2026-06-08T10:00:00.000Z"
}
```

- `dbResponseMs` — time to execute `SELECT 1`. Alert if consistently > 500 ms.
- Render monitors `/health` automatically and will redeploy if it returns 5xx.

### Optional: External Uptime Monitor

Set up a free monitor at [UptimeRobot](https://uptimerobot.com/) or [BetterStack](https://betterstack.com/):
- URL: `https://wfm-system.onrender.com/health`
- Interval: every 5 minutes
- Alert keyword: `"status":"ok"` (string match)
- Notify via email/Telegram on failure

---

## Backup Schedule Recommendation

| Frequency | Method | Retention | Who |
|---|---|---|---|
| Daily (automatic) | Supabase built-in | 7 days | Supabase |
| Weekly (manual) | pg_dump | Keep last 4 | System admin |
| Before major changes | pg_dump | Keep permanently | System admin |
| Before code deployments | Supabase snapshot | Retain 24 h | Supabase |

---

## What Is Backed Up

The Supabase backup covers all PostgreSQL tables including:

| Table | Contents |
|---|---|
| `users` | Admin/scheduling/technician accounts |
| `customers` | All customer records and addresses |
| `appointments` | All scheduled and historical appointments |
| `maintenance_tasks` | Task status, notes, completion data |
| `task_history` | Full status change history per task |
| `postponement_records` | Postponement reasons and new dates |
| `notifications` | Maintenance reminders per user |
| `audit_logs` | Full audit trail of all system actions |
| `event_logs` | Domain event history |
| `direct_messages` | Inter-department messages |
| `system_configs` | Access codes (stored hashed in future; currently plaintext) |
| `user_settings` | Per-user display preferences |

> The `system_configs` table stores department access codes. After a restore, verify codes are correct
> via Admin → Access Code Management.

---

## What Is NOT Backed Up

- The Render backend process itself (it is rebuilt from GitHub on each deploy)
- Electron installer files (rebuild from source: `npm run build` in `packages/unified-app`)
- Environment variables on Render (document these separately and store securely)

---

## Emergency Recovery Checklist

If the system is down:

- [ ] Check Render dashboard — is the service running?
- [ ] Check `GET /health` — does it return `database: connected`?
- [ ] Check Supabase dashboard — is the project paused or over quota?
- [ ] If DB is corrupted: initiate backup restore from Supabase dashboard
- [ ] If code is broken: revert last commit on GitHub (`git revert HEAD`) — Render auto-deploys
- [ ] After restore: log into each department and verify data
- [ ] Update audit log with recovery action
