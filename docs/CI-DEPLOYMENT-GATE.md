# Production validation gate — what's automated vs. what's an external setting

This repository's GitHub Actions workflow (`.github/workflows/production-validation.yml`,
job/check name **"Production Validation"**) automatically validates every pull request
targeting `main` and every push to `main`: reproducible install, Prisma schema
validate/generate, `prisma migrate deploy` against a disposable Postgres service,
backend typecheck + build, the full permanent backend regression suite, and the web
app's production build.

**That workflow, by itself, does not stop a bad commit from being deployed.** GitHub
Actions and Render/Vercel's Git integrations are three independent systems. Render and
Vercel both deploy from `main` the moment they see a new commit there, regardless of
whether a GitHub Actions run against that commit is still running, or even failed. This
repository has no file-based way to change that — it is configured entirely in the
GitHub and Render/Vercel dashboards. The two steps below are what actually close that
gap; **neither has been performed by this change** — they require access to those
dashboards.

## 1. GitHub branch protection (the real gate — do this first)

Render and Vercel both deploy from whatever is on `main`. The only reliable way to stop
a broken commit from ever reaching `main` is to require the check to pass before a pull
request can be merged, and to stop direct pushes that skip review entirely:

1. GitHub repo → **Settings → Branches → Add branch protection rule** (or edit the
   existing rule for `main`).
2. Branch name pattern: `main`.
3. Enable **"Require a pull request before merging"** — this is what makes "require
   status checks" actually meaningful; without it, someone can still push straight to
   `main` and skip the check entirely.
4. Enable **"Require status checks to pass before merging"**, then search for and
   select **`Production Validation`** (the exact job name in
   `production-validation.yml`). It will only appear in that search box after the
   workflow has run at least once on this repository.
5. Optionally enable "Require branches to be up to date before merging" for extra
   safety against stale merges.
6. Save.

Until this is done, "Production Validation" is a parallel status check, not a merge
gate — a PR can be merged (and a direct push to `main` can happen) whether or not it
passes.

## 2. Render / Vercel deploy settings (secondary — optional hardening)

`render.yaml` (the Render Blueprint spec) has no field that makes a deploy wait on an
external GitHub Actions run — this is a real platform limitation, not something this
repository's configuration can work around. The same is true for Vercel's
`vercel.json` / project settings: there is no supported, verifiable-from-this-repo
field that pauses a production deployment pending a third-party CI check. **Do not
assume either dashboard has a "wait for CI" toggle** without confirming it directly in
that dashboard for your specific plan/tier — this document does not claim one exists.

Given that, step 1 (GitHub branch protection on `main`) is the actual gate: since both
Render (`pure-home`, `pure-home-web`) and Vercel deploy from `main`, and branch
protection is what controls what can reach `main`, protecting `main` transitively
protects both deploy targets without needing platform-specific configuration.

If you want to check whether your current Render/Vercel plan offers anything stronger
(e.g. a native "required check" deploy condition), that would need to be verified
directly in each dashboard — Render → service → Settings → Build & Deploy; Vercel →
project → Settings → Git — rather than assumed here.

## Summary

| Layer | Status |
|---|---|
| Automated validation (install, Prisma, typecheck, build, tests, web build) | ✅ Implemented — runs on every PR to `main` and every push to `main` |
| PR merges to `main` actually blocked on that validation | ❌ Requires the GitHub branch-protection steps above (not yet configured) |
| Direct pushes to `main` blocked | ❌ Requires "Require a pull request before merging" in the same rule |
| Render/Vercel deploy blocked on CI success specifically | ❌ Not supported via repository configuration; mitigated only by protecting `main` (step 1) |
