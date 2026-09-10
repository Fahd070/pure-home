# Production validation gate — what's automated vs. what's an external setting

This repository's GitHub Actions workflow (`.github/workflows/production-validation.yml`,
job/check name **"Production Validation"**) automatically validates every pull request
and every push targeting **either** `main` **or** `v4/integration`: reproducible
install, Prisma schema validate/generate, `prisma migrate deploy` against a disposable
Postgres service, backend typecheck + build, the full permanent backend regression
suite, and the web app's production build. No path filters are used on either branch —
the same full job runs regardless of which files changed.

`main` and `v4/integration` are not equivalent branches, only equivalently validated:

- **`main`** — the Production-connected branch. Render and Vercel deploy from it (see
  below). This is the branch the rest of this document's gating discussion is about.
- **`v4/integration`** — a temporary, non-production v4 development integration
  branch, created to hold Phase 1–4 of the v4.0.0 development cycle without exposing
  Production to a partially completed release. Nothing deploys from it. It receives
  the identical validation job purely so that Phase 2/3/4 feature PRs targeting it get
  real CI feedback instead of none; it is a development safety net, not a Production
  gate, and this workflow never deploys Production regardless of which of the two
  branches triggered the run.

**That workflow, by itself, does not stop a bad commit on `main` from being deployed.**
GitHub Actions and Render/Vercel's Git integrations are three independent systems.
Render and Vercel both deploy from `main` the moment they see a new commit there,
regardless of whether a GitHub Actions run against that commit is still running, or
even failed. This repository has no file-based way to change that — it is configured
entirely in the GitHub and Render/Vercel dashboards. The two steps below are what
actually close that gap for `main`; **neither has been performed by this change** —
they require access to those dashboards.

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

## 3. `v4/integration` branch protection (current actual state)

As of this writing, `v4/integration` has **no GitHub branch protection rule and is not
covered by any ruleset** — it accepts direct pushes and does not require a passing
`Production Validation` run before anything lands on it. This is stated as fact, not
recommendation: do not assume otherwise, and do not treat this document as claiming
protection that has not actually been configured in the GitHub dashboard.

Before Phase 2 feature work begins in earnest, the minimum recommended protection for
`v4/integration` mirrors `main`'s pattern:

- **Require a pull request before merging** — so direct pushes to `v4/integration`
  stop being possible (the CI-bootstrap commit that introduced this trigger change was
  a one-time, explicitly authorized exception to that pattern, not the normal flow).
- **Require status checks to pass before merging**, selecting **`Production
  Validation`** — the same check name `main` already requires, since both branches run
  the identical job.
- Optionally, "Require branches to be up to date before merging".

Adding this protection is a repository-settings change and is **not** performed by
this document or by the workflow-trigger change described above — it needs the same
kind of dashboard action as `main`'s protection in section 1.

## 4. v4 development workflow

With the trigger change above in place, day-to-day v4 feature development follows:

```
feature branch
  → PR targeting v4/integration
  → Production Validation runs automatically
  → review
  → merge into v4/integration
```

`v4/integration` is never deployed to, so a merge there has no Production impact by
itself. When the full v4 cycle (all phases) is complete and integrated:

```
v4/integration
  → PR targeting main
  → Production Validation runs automatically
  → controlled migration / deployment / release process (separate from this document)
```

That final `v4/integration → main` step is where the existing `main`-specific
branch-protection and deployment discussion above (sections 1–2) applies in full —
merging into `main` is what actually risks reaching Production, and everything this
document says about `main`'s gate being incomplete without the dashboard steps in
section 1 still holds at that point.

## Summary

| Layer | Status |
|---|---|
| Automated validation (install, Prisma, typecheck, build, tests, web build) | ✅ Implemented — runs on every PR to `main`/`v4/integration` and every push to `main`/`v4/integration` |
| PR merges to `main` actually blocked on that validation | ❌ Requires the GitHub branch-protection steps above (not yet configured) |
| Direct pushes to `main` blocked | ❌ Requires "Require a pull request before merging" in the same rule |
| Render/Vercel deploy blocked on CI success specifically | ❌ Not supported via repository configuration; mitigated only by protecting `main` (step 1) |
