# Pure Home — Render + Supabase Deployment Guide

Version 1.0.0 | Backend: Render (Node.js) | Database: Supabase (PostgreSQL)

---

## Architecture

```
Employee PCs  →  Electron Desktop App (v1.4.0)
                        │  HTTPS + Socket.IO
                        ▼
               Render Web Service (Node.js)
               https://pure-home.onrender.com
                        │  Prisma ORM
                        ▼
               Supabase (PostgreSQL)
               aws-0-[region].pooler.supabase.com:6543
```

The Electron app is installed on each employee PC. All three departments (Admin, Scheduling, Technician)
connect to the same backend service. No local server required.

---

## Prerequisites

- A **Render** account (https://render.com) — free tier or paid
- A **Supabase** account (https://supabase.com) — free tier sufficient
- A **GitHub** account with the `pure-home` repository pushed

---

## Step 1 — Supabase Setup

1. Create a new Supabase project
2. Wait for the database to provision (~2 minutes)
3. Go to **Project Settings → Database → Connection String**
4. Copy the **Transaction mode (pgBouncer)** URL — it looks like:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
5. Add `?pgbouncer=true&connection_limit=1` to the end of the URL
6. Save this URL as `DATABASE_URL` for Render (Step 2)

> The tables (`users`, `customers`, `system_configs`, `user_settings`, etc.) are created automatically
> when the backend starts for the first time. No manual schema setup is required.

---

## Step 2 — Render Setup

1. Go to Render Dashboard → **New → Web Service**
2. Connect your GitHub repository (`pure-home` or your fork)
3. Configure the service:

| Setting | Value |
|---|---|
| **Name** | `pure-home` |
| **Runtime** | Node |
| **Root Directory** | `packages/backend` |
| **Build Command** | `npm install && npx prisma generate && npm run build` |
| **Start Command** | `node dist/index.js` |
| **Health Check Path** | `/health` |

4. Set **Environment Variables** (Environment tab):

| Key | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Required |
| `DATABASE_URL` | `postgresql://...` | From Supabase Step 1 |
| `JWT_SECRET` | (random 48-char hex) | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_CODE` | `(4 digits)` | Optional — overridden via Admin UI |
| `SCHEDULING_CODE` | `(4 digits)` | Optional — overridden via Admin UI |
| `TECHNICIAN_CODE` | `(4 digits)` | Optional — overridden via Admin UI |
| `TECHNICIAN_EMAIL` | `tech1@wfm.local` | Email of technician account |

5. Click **Create Web Service** — Render will build and deploy automatically

---

## Step 3 — Database Seeding

After first deploy, seed the initial user accounts using the Supabase SQL editor or psql:

```sql
-- Create admin user (password: change this immediately)
INSERT INTO users (id, name, email, password, role)
VALUES (
  gen_random_uuid(),
  'Admin',
  'admin@wfm.local',
  -- Use bcrypt hash. Generate at https://bcrypt-generator.com with cost=10
  '$2a$10$REPLACE_WITH_BCRYPT_HASH',
  'ADMIN'
);

-- Create scheduling user
INSERT INTO users (id, name, email, password, role)
VALUES (
  gen_random_uuid(),
  'Scheduling',
  'sched@wfm.local',
  '$2a$10$REPLACE_WITH_BCRYPT_HASH',
  'SCHEDULING'
);

-- Create technician user
INSERT INTO users (id, name, email, password, role)
VALUES (
  gen_random_uuid(),
  'Technician',
  'tech1@wfm.local',
  '$2a$10$REPLACE_WITH_BCRYPT_HASH',
  'TECHNICIAN'
);
```

---

## Step 4 — Verify Deployment

```bash
# Health check
curl https://pure-home.onrender.com/health
# Expected: {"status":"ok","database":"connected","dbResponseMs":...}

# Auth check
curl -X POST https://pure-home.onrender.com/api/auth/code-login \
  -H "Content-Type: application/json" \
  -d '{"code":"9012","dept":"admin"}'
# Expected: {"success":true,"data":{"token":"...","user":{...}}}
```

---

## Continuous Deployment

Every `git push` to the `main` branch triggers a Render auto-deploy:

```bash
# Make changes in Desktop\WFM-System-Updated\
git add .
git commit -m "your message"
git push
# Render deploys automatically in ~2-3 minutes
```

The `render.yaml` at the project root defines the service configuration. Render reads this file automatically.

---

## Free Tier Notes

| Service | Free Tier Limitation | Impact |
|---|---|---|
| Render | Service **spins down after 15 min inactivity** | First request after idle takes ~30 seconds to wake up |
| Supabase | 500 MB storage, 2 active projects | Sufficient for most deployments |

**Workaround for Render spin-down:**
- Set up UptimeRobot (free) to ping `/health` every 14 minutes
- Or upgrade to Render Starter plan ($7/month) for always-on

---

## Updating the Backend

```bash
# 1. Make code changes in packages/backend/src/
# 2. Test locally: npm run dev (from packages/backend)
# 3. TypeScript check: npx tsc --noEmit
# 4. Commit and push — Render deploys automatically
git push
```

---

## Rollback

If a deployment breaks production:

```bash
# Option A: Revert last commit
git revert HEAD
git push
# Render redeploys the reverted version

# Option B: From Render dashboard
# Go to Deploy History → select a previous deploy → click "Redeploy"
```

---

## Environment Variable Reference

See `packages/backend/.env.example` for all variables with descriptions.
