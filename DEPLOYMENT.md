# WFM System — Deployment Guide

Pure Home Water Filter Maintenance System  
Version 1.0 | 6-Employee LAN Deployment

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  SERVER PC  (one dedicated machine, stays powered on)    │
│                                                          │
│  PostgreSQL  :5432  ←── loopback only                   │
│  WFM Backend :3001  ←── LAN-accessible (JWT-protected)  │
│  Electron app       ←── optional, Admin role            │
└───────────────────────┬──────────────────────────────────┘
                        │   Office LAN  (192.168.x.x)
          ┌─────────────┼─────────────┐
          │             │             │
    PC #2 (Scheduling) PC #3 (Technician) PC #4–6
    Electron app only  Electron app only  any role
    serverUrl = http://192.168.x.x:3001
```

All clients connect to the **same** backend and database.  
Real-time events propagate to all connected clients via Socket.io.

---

## Network Requirements

| Requirement | Detail |
|---|---|
| Topology | All PCs on the same LAN switch or Wi-Fi router |
| Server PC IP | Static (see Step 1 below) — example: `192.168.1.100` |
| Port | TCP 3001 inbound on server PC (opened by `configure-firewall.ps1`) |
| Internet | Not required for the application |
| Bandwidth | Minimal — all traffic is local JSON/WebSocket |

---

## Part A — Server PC Setup

Run these steps **once**, in order, on the machine designated as the server.

### Step 1 — Assign a Static LAN IP

A static IP ensures the server URL (`http://192.168.1.100:3001`) never changes after a router restart.

**Option A — Script (recommended):**
```powershell
# Run as Administrator
.\scripts\set-static-ip.ps1
```
The script reads the current DHCP-assigned IP and converts it to static using the same address.  
Note the IP printed at the end — this is your `SERVER_IP`.

**Option B — Manual (Windows Settings):**
1. Settings → Network & Internet → your adapter → Edit
2. Switch to Manual / Static
3. Fill in: IP = your current IP, Subnet = 255.255.255.0, Gateway = router IP (usually 192.168.1.1)
4. DNS Primary: 8.8.8.8, Secondary: 8.8.4.4

**Verify:** Open another PC on the same network and run `ping 192.168.1.100` — you should get replies.

---

### Step 2 — Install Prerequisites

Install on the server PC only.

**PostgreSQL 15 or 16:**
- Download from https://www.postgresql.org/download/windows/
- During setup: set a password for the `postgres` user, keep port 5432
- Let the installer add PostgreSQL to PATH (required for the backup script)

**Node.js 20 LTS:**
- Download from https://nodejs.org — choose **"Add to PATH"** and **"Install for all users"**
- Verify: open a new PowerShell and run `node --version`

---

### Step 3 — Install the Backend

```powershell
# 1. Copy the project to a permanent location (do NOT install from the Desktop)
robocopy C:\Users\fahd1\Desktop\WFM-System-Updated C:\WFM /E /XD node_modules dist out dist-installer backups .git

# 2. Install backend dependencies
cd C:\WFM\packages\backend
npm install

# 3. Generate Prisma client
npm run db:generate

# 4. Create the database
# Open pgAdmin or psql and run: CREATE DATABASE wfm_db;
# Or from PowerShell (replace 'postgres' with your PostgreSQL password):
$env:PGPASSWORD = "postgres"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE wfm_db;"

# 5. Run database migrations
npm run db:migrate

# 6. Seed initial users
npm run db:seed

# 7. Compile the backend
npm run build
```

---

### Step 4 — Configure Firewall

```powershell
# Run as Administrator — opens port 3001 for LAN traffic only
C:\WFM\scripts\configure-firewall.ps1
```

Output will confirm the rule was created and print the server's LAN IP.

---

### Step 5 — Configure Auto-Start

The backend will start automatically every time Windows boots.

```powershell
# Run as Administrator
C:\WFM\scripts\install-autostart.ps1
```

The script:
- Builds the backend if the `dist/` folder is missing
- Registers a Windows Scheduled Task (runs as SYSTEM before login)
- Starts it immediately — no reboot required

**Verify it is running:**
```powershell
Invoke-WebRequest http://127.0.0.1:3001/health | Select-Object -Expand Content
# Expected: {"status":"ok","database":"connected","timestamp":"..."}
```

---

### Step 6 — (Optional) Install Electron App on Server PC

If the admin will also use this machine:
1. Copy `WFM System Setup 1.0.0.exe` to the server PC
2. Run the installer
3. Open the app → Server Setup → enter `http://127.0.0.1:3001` → Test & Save

---

## Part B — Client PC Setup

Repeat for each of the 5 employee workstations.

### Step 1 — Install the Application

1. Copy `WFM System Setup 1.0.0.exe` from the server to the client PC (USB, shared folder, etc.)
2. Double-click and complete the installer (no administrator rights required for NSIS install)
3. A desktop shortcut "WFM System" will be created

### Step 2 — Configure the Server URL

1. Open the WFM System application
2. On the department selection screen, click **⚙ Server Setup** (bottom of the screen)
3. Enter the server URL: `http://192.168.1.100:3001`  
   *(replace with your actual server IP from Step 1 Part A)*
4. Click **Test & Save**
5. Wait for the green "Connected" message
6. Click Back and log in with your department code

**The URL is saved permanently** — this only needs to be done once per machine.

### Step 3 — Verify Connection

The department selector shows a small status dot next to the server URL:
- **Green dot** = connected to LAN server
- **Yellow dot** = using localhost (server on same machine)

---

## Part C — Backup Procedures

### Automated Daily Backup

Schedule using Windows Task Scheduler on the server PC:

1. Open Task Scheduler → Create Basic Task
2. Name: "WFM Daily Backup"
3. Trigger: Daily, at 08:00 AM (or before work starts)
4. Action: Start a program
   - Program: `powershell.exe`
   - Arguments: `-ExecutionPolicy Bypass -File "C:\WFM\scripts\backup-database.ps1"`
5. Finish

Or register via PowerShell (as Administrator):
```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument '-ExecutionPolicy Bypass -File "C:\WFM\scripts\backup-database.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At "08:00"
Register-ScheduledTask -TaskName "WFM Daily Backup" -Action $action -Trigger $trigger `
    -RunLevel Highest -Force
```

**Backup location:** `C:\WFM\backups\wfm_backup_YYYY-MM-DD_HH-mm-ss.sql`  
**Retention:** Last 14 backups kept automatically (older ones deleted by the script)

### Manual Backup

```powershell
C:\WFM\scripts\backup-database.ps1
```

### Off-Site Backup (Recommended)

Copy the `C:\WFM\backups\` folder to:
- An external USB drive (weekly)
- A NAS device on the LAN
- A cloud-synced folder (OneDrive, Google Drive)

---

## Part D — Restore Procedures

### Full Database Restore

```powershell
# 1. Stop the backend
Stop-ScheduledTask -TaskName "WFM Backend"

# 2. Drop and recreate the database
$env:PGPASSWORD = "postgres"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "DROP DATABASE IF EXISTS wfm_db;"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE wfm_db;"

# 3. Restore from backup file
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d wfm_db `
    -f "C:\WFM\backups\wfm_backup_2026-06-07_08-00-00.sql"

# 4. Restart the backend
Start-ScheduledTask -TaskName "WFM Backend"
```

### Verify Restore

```powershell
Invoke-WebRequest http://127.0.0.1:3001/health | Select-Object -Expand Content
```

---

## Part E — Troubleshooting

### Backend not starting

```powershell
# Check task status
Get-ScheduledTask -TaskName "WFM Backend" | Get-ScheduledTaskInfo

# Check if port is in use
netstat -ano | findstr :3001

# Run manually to see error output
cd C:\WFM\packages\backend
node dist/index.js
```

### Client cannot connect to server

```powershell
# From the CLIENT PC — test connectivity to the server
Test-NetConnection -ComputerName 192.168.1.100 -Port 3001

# From the SERVER PC — confirm backend is running and reachable
Invoke-WebRequest http://127.0.0.1:3001/health | Select-Object -Expand Content
Invoke-WebRequest http://192.168.1.100:3001/health | Select-Object -Expand Content

# Check firewall rule is present on server PC
Get-NetFirewallRule -DisplayName "WFM Backend (port 3001)"
```

**Common causes:**
| Symptom | Fix |
|---|---|
| Timeout (no response) | Run `configure-firewall.ps1` on server PC; verify server IP is correct |
| "Connection refused" | Backend is not running — check Scheduled Task, start manually |
| "Wrong server URL" | In app → Server Setup → re-enter correct IP |
| Client shows yellow dot (localhost) | URL was never changed — click ⚙ Server Setup |

### PostgreSQL not starting

```powershell
# Check service status
Get-Service -Name "postgresql*"

# Start it
Start-Service -Name (Get-Service -Name "postgresql*").Name
```

### Login fails after password reset

Re-seed only if absolutely necessary (this resets all user passwords):
```powershell
cd C:\WFM\packages\backend
npm run db:seed
```

### Real-time updates not appearing on a client

1. Verify the client's socket connection: look for the connection banner (yellow/red bar at top)
2. Reload the application (close and reopen)
3. Verify the server is running: `Test-NetConnection -ComputerName 192.168.1.100 -Port 3001`

---

## Part F — Real-Time Synchronization Reference

All events propagate via Socket.io within **< 100 ms** on a local network.

| Action | Event emitted | Who receives it |
|---|---|---|
| Customer created | `customer:created` | All roles |
| Customer updated | `customer:updated` | All roles |
| Customer deleted | `customer:deleted` | All roles |
| Appointment created | `appointment:created` | All roles |
| Appointment status change | `appointment:status` | All roles |
| Task approved / assigned | `task:approved` | Technician + Scheduling |
| Task started | `task:approved` | All roles |
| Task completed | `task:completed` | All roles |
| Task postponed | `task:postponed` | All roles |
| New notification | `notification:new` | All roles |
| New audit log entry | `audit:new` | All roles |
| New direct message | `dm:new` | Recipient role only |
| Message deleted | `dm:deleted` | Relevant roles |

**Polling fallback:** React Query refetches all data every 30 seconds as a safety net for any missed socket events.

---

## Part G — Maintenance

### Backend update procedure

```powershell
# 1. Stop the running task
Stop-ScheduledTask -TaskName "WFM Backend"

# 2. Apply source changes (copy new files)
# ...

# 3. Install any new dependencies
cd C:\WFM\packages\backend
npm install

# 4. Run any new migrations
npm run db:migrate

# 5. Rebuild
npm run build

# 6. Restart
Start-ScheduledTask -TaskName "WFM Backend"

# 7. Verify
Invoke-WebRequest http://127.0.0.1:3001/health | Select-Object -Expand Content
```

### Electron app update

1. Build a new installer from the updated source
2. Copy the `.exe` to each client PC
3. Run the installer — it will update in place
4. Server URL is preserved (stored in electron-store)

### Department access code change

Edit `C:\WFM\packages\backend\.env`:
```
ADMIN_CODE=xxxx
SCHEDULING_CODE=xxxx
TECHNICIAN_CODE=xxxx
```
Then restart the backend:
```powershell
Stop-ScheduledTask -TaskName "WFM Backend"
Start-ScheduledTask -TaskName "WFM Backend"
```
No rebuild required — codes are read at runtime from the environment.

---

## Quick Reference

| Item | Value |
|---|---|
| Server URL (LAN) | `http://192.168.1.100:3001` |
| Health check | `http://192.168.1.100:3001/health` |
| Backend source | `C:\WFM\packages\backend\` |
| Backend config | `C:\WFM\packages\backend\.env` |
| Backups | `C:\WFM\backups\` |
| Scheduled task | Task Scheduler → "WFM Backend" |
| Firewall rule | Windows Firewall → "WFM Backend (port 3001)" |
| PostgreSQL service | services.msc → postgresql-x64-16 |
