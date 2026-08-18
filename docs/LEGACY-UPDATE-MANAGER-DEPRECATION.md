# Legacy Update Manager Deprecation

## What changed

Pure Home used to have **two independent update mechanisms** running at once
on a server PC set up via `scripts/install-production.ps1`:

1. **`electron-updater`**, running inside the desktop app itself — checks
   GitHub Releases shortly after each launch, downloads updates in the
   background.
2. **`scripts/update-manager.ps1`**, run every 6 hours by a Windows Scheduled
   Task named `WFM Update Manager` — independently checked GitHub Releases,
   downloaded the installer, **force-stopped the shared backend and any node
   process bound to port 3001**, ran the installer silently, and restarted the
   backend.

These two mechanisms had no awareness of each other. Anyone actively using the
app when the scheduled task fired could see the backend disappear mid-session
with no warning, and the two updaters could race installing the desktop app at
the same time.

`electron-updater` is now the **single canonical update mechanism**. The
scheduled-task updater is deprecated.

## What happened to `update-manager.ps1`

The file still exists at `scripts/update-manager.ps1` (existing installations'
Scheduled Tasks reference it by path), but it no longer does anything. It logs
one line to `C:\ProgramData\Pure Home\logs\updates.log` noting that it is
deprecated, and exits. It no longer:

- stops or starts the backend
- kills any process
- downloads or installs anything

## What happened to `install-production.ps1`

New (or re-run) installs no longer register the `WFM Update Manager` scheduled
task. If the installer detects that task already exists on a machine (from a
previous install), it removes it automatically as part of the normal,
administrator-initiated install run.

## Do you need to do anything manually?

Only if a server PC already has the `WFM Update Manager` scheduled task
registered **and you don't plan to re-run `install-production.ps1` on it**.

Check whether the task exists:

```powershell
Get-ScheduledTask -TaskName "WFM Update Manager" -ErrorAction SilentlyContinue
```

If it returns a result, remove it with the dedicated, idempotent cleanup
script (run once, as Administrator, on that machine):

```powershell
.\scripts\remove-legacy-update-task.ps1
```

This script touches only the `WFM Update Manager` task. It does not affect
`WFM Backend` or `WFM Watchdog`, and it is safe to run more than once — it
simply reports "not found" if the task is already gone.

This cleanup is **not** run automatically by this repository or by any CI
workflow. It is a deliberate, one-time action for an administrator to take on
each affected machine.

## Why not just delete `update-manager.ps1`?

Existing Scheduled Tasks reference the script by absolute path. Deleting the
file outright would make an already-registered (but not yet cleaned up) task
fail with a "file not found" error instead of exiting cleanly and leaving a
clear log entry pointing at the cleanup script. Keeping a harmless stub in
place is the safer transition.
