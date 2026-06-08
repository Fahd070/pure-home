# WFM System — Troubleshooting Guide

Version 1.4.0

---

## Quick Diagnosis

Start here before reading the sections below.

```
1. Is the Render service running?   → https://dashboard.render.com
2. Does /health respond?            → GET https://wfm-system.onrender.com/health
3. Is Supabase reachable?           → https://app.supabase.com → your project → home
```

If all three are green, the problem is almost always on the client side.

---

## Desktop App Issues

### App shows "Cannot connect to server"

**Symptoms:** Red connection indicator, "Server unreachable" toast on startup

**Causes and fixes:**

1. **Server is sleeping (Render free tier)**
   - Free Render services spin down after 15 minutes of inactivity
   - Fix: Wait 20–30 seconds and retry. The server wakes on first request.
   - Permanent fix: Set up UptimeRobot to ping `/health` every 14 minutes, or upgrade to Render Starter ($7/mo)

2. **Wrong server URL saved**
   - Open the app → Settings icon (or navigate to `ServerSetup` screen)
   - Re-enter the correct URL with `https://` and no trailing slash
   - Click Test Connection, then Save

3. **Firewall or proxy blocking outbound HTTPS**
   - Try opening the server URL in a browser from the same PC
   - If the browser also fails, ask IT to whitelist the Render domain

4. **Render service is down**
   - Check the Render status page and your service's deploy history
   - If the last deploy failed, revert: `git revert HEAD && git push`

---

### App opens but shows blank/white screen

**Cause:** Corrupted localStorage or cached bad state

**Fix:**
1. Close the app completely (right-click taskbar → Quit)
2. Delete `C:\ProgramData\WFM System\` (or `%APPDATA%\WFM System\`)
3. Relaunch — re-enter the server URL when prompted

---

### Login fails with correct access code

**Symptoms:** "Invalid code" after entering the right digits

**Causes and fixes:**

1. **Wrong department selected**
   - Each department has a unique code. Make sure you selected Admin / Scheduling / Technician correctly.

2. **Code was changed in the Admin panel**
   - Ask your admin to confirm the current code for your department

3. **Server can't reach the database**
   - Check `/health` — if `database` is `disconnected`, the DB is the issue (see Database section below)

4. **JWT_SECRET was rotated on Render**
   - Rotating `JWT_SECRET` invalidates all existing tokens. All users need to log in again. This is expected.

---

### Real-time updates not arriving (tasks, notifications)

**Symptoms:** Data appears stale, notifications delayed, badge counts wrong

**Causes and fixes:**

1. **Socket.IO connection dropped**
   - Refresh the page / restart the app. Socket reconnects automatically within ~5 seconds.
   - Check browser dev tools (F12 → Console) for WebSocket errors

2. **Token expired**
   - Log out and log back in. JWT tokens expire; once expired, the socket auth also fails.

3. **Server just redeployed**
   - Render restarts the process on every deploy, dropping all active socket connections.
   - Clients reconnect automatically, but may take a few seconds.

---

### PDF report opens blank or fails to open

**Symptoms:** Clicking "Export PDF" does nothing, or a blank window flashes

**Cause:** Electron's sandboxed PDF window failed to load

**Fix:**
1. Make sure the server is reachable (the PDF renderer fetches live data)
2. Restart the app
3. If it persists, check `C:\ProgramData\WFM System\logs\` for renderer errors

---

## Backend / Render Issues

### Render deploy failed

**Check:** Render Dashboard → Your Service → Deploy History → click the failed deploy → view logs

**Common causes:**

| Error in logs | Fix |
|---|---|
| `Cannot find module '...'` | `npm install` didn't complete — retrigger deploy |
| `prisma generate` failed | Check that `DATABASE_URL` is set in Render environment |
| `Bind EADDRINUSE` | Port conflict — unlikely on Render, check `PORT` env var |
| TypeScript errors | Run `npx tsc --noEmit` locally and fix before pushing |
| `ETIMEDOUT` connecting to DB | Check Supabase connection string — use port 6543 (pgBouncer) not 5432 |

---

### Health endpoint returns `status: degraded`

```json
{"status":"degraded","database":"disconnected"}
```

**Means:** The backend process is running, but Prisma cannot reach Supabase.

**Causes and fixes:**

1. **Supabase project paused** (free tier pauses after 1 week of inactivity)
   - Go to Supabase dashboard → your project → click **Restore project**
   - Wait ~2 minutes for the database to wake up
   - Render will automatically reconnect on the next request

2. **Wrong connection string**
   - Confirm `DATABASE_URL` in Render uses port **6543** (pgBouncer/Transaction mode), not 5432
   - Confirm `?pgbouncer=true&connection_limit=1` is at the end of the URL

3. **Supabase credentials changed**
   - If you reset your database password, update `DATABASE_URL` in Render environment variables and redeploy

4. **IP allowlist on Supabase**
   - Check Supabase → Project Settings → Network → ensure Render's IP is not blocked
   - Supabase free projects have no IP restrictions by default

---

### `dbResponseMs` is very high (> 1000 ms)

**Causes:**
- Supabase project is on a slow cold start (free tier)
- High query load or missing indexes
- Network latency between Render region and Supabase region

**Mitigation:**
- Both Render and Supabase should be in the same region (e.g., both `us-east-1`)
- Consider upgrading to Supabase Pro for dedicated compute

---

### API returns 401 Unauthorized unexpectedly

**Cause A:** JWT expired (default expiry is 7 days)
- Users need to log out and log back in

**Cause B:** `JWT_SECRET` was changed on Render
- All tokens issued with the old secret are invalid
- All users must re-authenticate

---

### API returns 403 Forbidden

**Cause:** User's role doesn't have permission for that action
- Check the route's `requireRole(...)` middleware in `packages/backend/src/routes/`
- Scheduling and Technician users cannot delete activity log entries (ADMIN only)
- Technicians can only act on tasks assigned to them

---

### CORS error in browser console

```
Access to XMLHttpRequest at 'https://...' blocked by CORS policy
```

**Cause:** The frontend origin is not in the backend CORS allowlist

**Fix in `packages/backend/src/app.ts`:**
- Add the origin to the `allowedOrigins` array
- For Socket.IO, update `packages/backend/src/socket.ts` CORS handler

---

## Database Issues

### Data appears after restore but timestamps are wrong

**Cause:** Timezone mismatch between app and database
- Supabase stores timestamps as UTC
- The frontend converts to local time using `toLocaleString()` / `toLocaleDateString()`
- This is expected behavior — the display adjusts to the local system clock

---

### Duplicate notifications appearing

**Cause:** The dedup key was not present in the notification body
- The cron job embeds keys like `[today:uuid]` to prevent duplicates
- If the backend was restarted mid-cron, a notification may have been created without the key
- These duplicates are harmless — they will not recur

---

### `system_configs` table missing after fresh deploy

**Symptom:** Access code login fails, admin cannot see codes

**Cause:** The table is created at server startup via `CREATE TABLE IF NOT EXISTS`. If startup failed, the table may not exist.

**Fix:**
1. Check Render logs for startup errors
2. If `DATABASE_URL` is wrong, fix it and redeploy
3. The table will be created automatically on successful startup

---

## Access Code Issues

### "Access code not found" after first deploy

**Cause:** No code has been saved to the database yet, and no `*_CODE` env var was set

**Fix:**
1. Set `ADMIN_CODE`, `SCHEDULING_CODE`, `TECHNICIAN_CODE` in Render environment variables
2. Redeploy — the codes will be used as fallback until overridden via the Admin UI
3. Log in and set permanent codes through Admin → Access Code Management

---

### Admin changed a code and locked everyone out

**Fix via Render environment variables:**
1. Set `ADMIN_CODE=XXXX` (your desired new code) in Render environment
2. Redeploy the service
3. The env var code is the fallback — the DB code takes precedence, so also update via SQL if needed:

```sql
UPDATE system_configs SET value = 'XXXX' WHERE key = 'ADMIN_CODE';
```

---

## Getting More Help

**Logs:**
- Render logs: Dashboard → Your Service → Logs tab (live + historical)
- Client logs: `C:\ProgramData\WFM System\logs\`

**Health check:**
```
GET https://wfm-system.onrender.com/health
```

**Report a bug:**
Include the following in your report:
1. What action triggered the issue
2. Exact error message or screenshot
3. Relevant log lines from Render or the client
4. The `/health` response at the time of the issue
