# Desktop Release & Distribution

How a new Pure Home desktop version reaches employee PCs, from v4 onward.

## Policy: manual updates only

The desktop app performs **no automatic update check, download, or install**.
There is no polling loop, no background updater, no remote update feed, and no
second repository acting as a release channel. A new version reaches a machine
exactly one way:

> Someone opens the download site, downloads the installer, and runs it.

This is deliberate. The fleet is small, the installer is per-machine and
requires Administrator elevation (`perMachine` + `requestedExecutionLevel:
requireAdministrator`), and updates are rolled out when the business decides to
— not five seconds after an employee happens to open the app.

### What enforces it

| Guarantee | Where |
|---|---|
| No check at startup | `packages/unified-app/electron/main/index.ts` — `setupUpdater()` contains no `checkForUpdates()` call and no timer |
| No silent download if a check is ever added back | same file — `autoUpdater.autoDownload = false` |
| No install on quit | same file — `autoUpdater.autoInstallOnAppQuit = false` |
| No upload at build time | `packages/unified-app/package.json` — `electron-builder --publish never` |
| The download site never calls GitHub | `website/index.html` — driven only by `release.json` |

The updater *scaffolding* (event listeners, the `update:download` /
`update:install` IPC handlers, `UpdateBanner.tsx`) is intentionally left in
place. It is unreachable — nothing triggers it — and keeping it means a future
"Check for updates" menu item is a small change rather than a rebuild. It is
not free, though: see "Dormant scaffolding" below for the two stale banner
strings that would have to be fixed first.

---

## Distribution architecture

```
  developer machine                 installer host            download site
  -----------------                 --------------            -------------
  scripts/build-release.bat   -->   the .exe, uploaded  <--    website/index.html
     (local only, no creds)         by hand                    reads release.json
                                         ^                           |
                                         +------ installer.url ------+

  employee PC  <-- downloads the .exe from the download site, runs it
```

Three pieces, deliberately decoupled:

1. **The build** — local, credential-free, produces one `.exe`.
2. **The installer host** — wherever that `.exe` is served from. Currently a
   GitHub Release asset (see *Transition state* below); the intended target is
   Vercel Blob.
3. **The download site** — `website/`, a single static page plus
   `release.json`. It is the only distribution UI.

The site does not know or care where the installer is hosted. It reads one
absolute URL out of the manifest. Moving the installer to a different host is a
one-line manifest edit and a redeploy — no code change.

---

## `release.json`

`website/release.json` is deployed alongside `index.html` and served at
`./release.json`. It is edited **by hand**, once per release.

```json
{
  "version": "v3.6.5",
  "releasedAt": "2026-08-19T03:47:21Z",
  "installer": {
    "name": "Pure-Home-Setup-3.6.5.exe",
    "url": "https://.../Pure-Home-Setup-3.6.5.exe",
    "sizeBytes": 107323836
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `version` | string | Shown verbatim on the page. Keep the `v` prefix. |
| `releasedAt` | string | ISO-8601 instant. Rendered in the visitor's language (`ar-SA` / `en-GB`). |
| `installer.name` | string | The installer filename. Informational. |
| `installer.url` | string | Absolute URL the Download button points at. |
| `installer.sizeBytes` | number | **Exact** byte size. The page divides by 1024² and rounds, so an approximation shows the wrong size. |

The page validates `version`, `installer.url` and `installer.sizeBytes` before
rendering. If the manifest is missing, returns a non-200, is not valid JSON, or
is missing any of those, the page enters its **failure state**: the Download
button is disabled and loses its `href` entirely, the metadata reads `—`, and a
localized notice explains that the download is unavailable.

There is **no fallback URL**. The page will never redirect a visitor to GitHub
Releases or anywhere else. A download that cannot work is worse than one that
is visibly switched off.

The manifest is fetched with `cache: 'no-store'`, because it is the one file
that changes on every release and a cached copy would keep serving the previous
installer's URL.

---

## Releasing a new version

Nothing in this procedure requires a credential. No GitHub token, no Vercel
token, no Blob token, no CI secret.

1. **Bump the version** in `packages/unified-app/package.json`. This drives the
   installer filename via `artifactName: Pure-Home-Setup-${version}.${ext}`.

2. **Build**, from the repository root:

   ```
   scripts\build-release.bat
   ```

   Output: `packages\unified-app\dist-installer\Pure-Home-Setup-<version>.exe`.
   `electron-builder` runs with `--publish never`, so this step uploads nothing
   and contacts no release host.

3. **Test the installer** on a clean Windows machine: install, launch, set the
   server URL, sign in to each department.

4. **Upload the `.exe`** to the installer host, by hand.

5. **Record the exact byte size** of the file you uploaded:

   ```powershell
   (Get-Item "packages\unified-app\dist-installer\Pure-Home-Setup-<version>.exe").Length
   ```

6. **Edit `website/release.json`** — all five fields. `installer.url` must be
   the URL of the file you just uploaded, fetchable over plain HTTPS with no
   authentication: the download site is public and cannot sign a request.

7. **Deploy the download site** (`website/` is its own Vercel project, separate
   from the web app).

8. **Verify in a browser**: the page shows the new version, date and size; the
   Download button's `href` is the new installer URL; downloading it produces a
   working installer.

There is no auto-update to verify, because there is none.

---

## Transition state (read this before making the repository private)

`release.json` currently points at the **real, existing** v3.6.5 GitHub Release
asset:

```
https://github.com/Fahd070/pure-home/releases/download/v3.6.5/Pure-Home-Setup-3.6.5.exe
```

That is the installer employees are actually running today. It was not
invented, and it was not replaced with a guessed future URL for a host that
does not exist yet.

**This URL works only while `Fahd070/pure-home` is public.** Release assets on
a private repository are not publicly downloadable; an unauthenticated request
answers 404.

**And it fails silently.** This is the part worth internalising: the manifest
itself would still load and still validate, because only the *installer* lives
on GitHub. The page would therefore show a normal, enabled, blue Download
button with the right version and size — and land the employee on a GitHub
404. The failure state built into this page does **not** cover a manifest that
is fine but points somewhere dead, and it cannot: the page has no way to probe
a cross-origin URL. Nothing here will warn you. The ordering below is the only
protection.

So the ordering is fixed:

1. Upload the installer to the new host (Vercel Blob or equivalent).
2. Update `installer.url` in `release.json` to that URL and redeploy the site.
3. Confirm in a signed-out browser that the download works.
4. **Only then** make the repository private.

Doing step 4 first breaks the download site for everyone. The site itself is
already fully detached from GitHub — no API call, no fallback link — so after
step 2 nothing on the page depends on the repository's visibility.

### Why the page's copy makes no claim about updater behaviour

Desktop is still at **3.6.5** — deliberately not bumped in this change set —
so the installer the page serves today is the v3.6.5 build, which *does* still
check GitHub five seconds after launch. The v4 policy above is manual-only.
Those two facts are both true at once during the transition, for as long as
`release.json` points at the v3.6.5 asset.

Because of that, the page's copy (`website/index.html`, the line near the
download card) deliberately says **only** "download the installer here when
you need to update" — it does not assert that updates are automatic, and it
does not assert that updates are manual. Either claim would be false for one
of the two builds a visitor might currently be running (an existing v3.6.5
install, or a fresh download). This wording is correct for v3.6.5 today and
stays correct once a manual-only v4 installer replaces it — nothing on the
page needs to change when that happens.

The **policy** documented at the top of this file is not weakened by that: v4
is manual-only, full stop. What's neutral is only the one line of marketing
copy on the public page, because that page has to describe whichever binary
`release.json` currently points at, and during the transition that binary is
still v3.6.5. Nothing in the repository enforces that `installer.version` in
the manifest and `version` in `packages/unified-app/package.json` agree — keep
them in step by hand.

---

## Backward compatibility

### Already-installed v3.6.5 clients

They are **not** modified by any of this, and no attempt is made to reach them.
They still run their own build of the updater, which checks GitHub Releases
about five seconds after launch. What happens to them:

| Repository state | v3.6.5 client behaviour |
|---|---|
| Public (today) | Check succeeds, finds v3.6.5, matches its own version, does nothing. |
| Private (later) | Check 404s once per launch. `UpdateBanner` shows a dismissible, non-blocking notice; the sanitized error goes to the local log. |

A failed update check has always been non-fatal — the error path sanitizes the
message (`updaterErrorSanitizer.ts`), shows a dismissible strip, and the app
continues normally. No data path, no login, and no feature depends on it. The
notice is cosmetic noise on old clients until they are upgraded, which is done
the same way as any other update: download the new installer and run it.

### Upgrading a v3.6.5 machine to v4

Run the v4 installer as Administrator. It installs in place over the existing
per-machine installation; the configured server URL and local preferences
(stored via `electron-store` under `wfm-unified`) are preserved. From that
point the machine performs no update checks at all.

### The download site

`index.html` remains a single self-contained static file with no build step and
no dependencies. `release.json` is additive — a new file next to it. Deploying
the two together is the whole change; there is nothing to migrate.

---

## `build.publish` — classification

`packages/unified-app/package.json` still contains:

```json
"publish": { "provider": "github", "owner": "Fahd070", "repo": "pure-home" }
```

**Classification: (A) safe dormant metadata.** It does not have to be removed
before the repository is made private. Specifically:

- **It contains no secret.** A GitHub username and a repository name, both
  already public in this repository's remote URL.
- **It cannot cause an upload.** Publishing requires a `GH_TOKEN` /
  `GITHUB_TOKEN` in the environment, which no build path sets. On top of that,
  the build script now passes `--publish never` explicitly, so the guarantee no
  longer rests on a token happening to be absent. CI never runs
  `electron-builder` at all — `production-validation.yml` runs `electron-vite
  build` only.
- **It cannot cause a runtime request.** electron-builder copies it into
  `app-update.yml` inside the packaged app, where `electron-updater` would read
  it — but only during a check, and v4 performs none.

It is therefore inert in the v4 build, and making the repository private does
not change that.

**It is not, however, correct for the future.** When a manual "Check for
updates" action is added and the installer lives on Blob, this block must be
*replaced* (with a `generic` provider pointing at the installer host), not
merely deleted — an updater with no publish config has nowhere to look. Leaving
it in place keeps that future edit visible in one obvious spot rather than
requiring it to be reconstructed from scratch.

---

## Dormant scaffolding

Still present, still wired, never triggered:

| Piece | State |
|---|---|
| `autoUpdater.on(...)` listeners in `setupUpdater()` | Registered; no event source, so never fire |
| `ipcMain.handle("update:download")` | Registered; nothing in the renderer invokes it |
| `ipcMain.handle("update:install")` | Registered; reachable only from the banner's "ready" phase, which needs an `update-downloaded` event that cannot occur |
| `window.electron.updater.*` in the preload | Exposed; the renderer only subscribes |
| `UpdateBanner.tsx` | Mounted; starts and stays in the `idle` phase, which renders `null` |

Consequence: the banner never appears, and two pieces of its copy are now
stale. Both are unreachable today; both must be fixed before any manual check
is added:

- the **error** phase says updates "will be checked again the next time the app
  starts" — no longer true;
- the **available** phase says "downloading automatically…" and carries no
  action button, because it was written when `autoDownload` was `true`. With
  `autoDownload: false` and nothing in the renderer calling
  `updater.download()`, a re-enabled check would strand that banner on
  "downloading automatically…" forever: no download, no progress, no button.

So adding a manual check later is *nearly* one call —
`autoUpdater.checkForUpdates()` behind a new IPC handler and a user-initiated
action, plus a correct `build.publish` target — but it also needs a Download
action wired into the banner's `available` phase and both strings corrected.
That is still far less than rebuilding the path from scratch, which is why the
scaffolding is kept; it is not zero work, and this note exists so nobody
discovers that halfway through.
