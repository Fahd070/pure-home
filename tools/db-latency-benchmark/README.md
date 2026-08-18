# DB latency benchmark (temporary)

Standalone, read-only tool to measure Supabase (production) latency from a
Render Web Service deployed in a different region than the real backend.
Not part of the Pure Home application. Never imports from `packages/backend`.
Never merged into `main`.

## What it does

`GET /health` runs exactly one operation, `prisma.$queryRaw\`SELECT 1\``, and
returns the elapsed time. `GET /` returns static text. Nothing else exists in
this directory: no other routes, no auth, no Socket.IO, no cron/timers, no
Prisma models, no migrations, no seed logic, no write SQL.

## Render service setup (manual — no authenticated Render access from this session)

1. Render dashboard → **New +** → **Web Service**.
2. Connect the `Fahd070/pure-home` repository, branch `ci/singapore-db-latency-benchmark`.
3. **Name:** `pure-home-db-latency-benchmark`
4. **Region:** Singapore
5. **Root Directory:** `tools/db-latency-benchmark`
6. **Runtime:** Node
7. **Build Command:** `npm install && npx prisma generate --schema=prisma/schema.prisma`
8. **Start Command:** `node index.js`
9. **Auto-Deploy:** Off
10. **Environment Variables:**
    - `DATABASE_URL` — copy the *exact* value from the production `wfm-system`
      service's Environment tab (Render dashboard → `wfm-system` → Environment
      → reveal → copy). Paste directly into this new service's Environment
      tab. Do not paste it anywhere else (chat, files, logs). This keeps the
      host, port, `pgbouncer`, and `connection_limit` settings identical to
      production, so the only variable being changed is the Render region.
    - `PORT` — leave unset; Render sets this automatically for Node web
      services (the app reads `process.env.PORT`, falling back to `3001`
      only if unset).
11. Create the service and wait for the build/deploy to finish.
12. Confirm `GET https://<assigned-service-url>.onrender.com/health` returns
    `{"status":"ok","database":"connected","dbResponseMs":...}`.

## Cleanup

After benchmarking is done and results are captured:
1. Render dashboard → this service → Settings → **Delete Web Service**.
2. `git push origin --delete ci/singapore-db-latency-benchmark` (or delete the
   branch from GitHub's branch list). This branch is never merged into `main`.
