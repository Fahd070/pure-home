# Backend regression suite

Permanent integration tests for the core employee-facing workflows. Uses Vitest +
Supertest against the real Express app (`src/app.ts`) and a real Socket.IO server,
running against a disposable local PostgreSQL database — never production.

## One-time setup

Start a disposable Postgres container (any name/port you like, must NOT be your real
dev database):

```
docker run -d --name wfm-test-db -e POSTGRES_PASSWORD=test -e POSTGRES_DB=wfm_test -p 5555:5432 postgres:15
```

Set the environment for the test run (the database name must contain "test" and the
host must be localhost/127.0.0.1 — enforced technically, see `tests/helpers/dbSafety.ts`):

```
export DATABASE_URL="postgresql://postgres:test@localhost:5555/wfm_test"
export JWT_SECRET="any-local-test-secret"
```

## Running

```
npm test
```

`pretest` automatically (1) refuses to run if `DATABASE_URL` doesn't look like a safe
local/disposable database, then (2) runs `prisma migrate deploy` against it — the same
canonical schema-setup path used everywhere else in this project, never `db push`.

Tests are self-seeding (idempotent upserts for users/access codes) and self-cleaning
(each file removes the records it creates), so the suite can be run repeatedly against
the same database, or against a freshly recreated one, with identical results.

## Notes

- Test users (`admin@test.local`, `scheduling@test.local`, `tech1@wfm.local`,
  `tech2@wfm.local`) and access codes (`5001`/`5002`/`5003`) exist only in this
  disposable database — never production values.
- Socket.IO tests start a real server on an ephemeral port per test file; no fixed
  port is required.
