# Database Backup Recovery

The `Database Backup` GitHub Actions workflow (`.github/workflows/db-backup.yml`)
produces a daily encrypted snapshot of the production database and uploads it as
a GitHub Actions artifact. This document explains how an authorized administrator
retrieves and decrypts one.

## Why the backup is encrypted

This repository is public — GitHub Releases here also serve as the distribution
channel for the Electron desktop app's auto-updater, so repository visibility
cannot be changed without breaking that separate architecture. On a public
repository, Actions artifacts are downloadable by any authenticated GitHub user,
not only collaborators. Since the backup contains the full production database
(customer names, phone numbers, addresses, appointment and payment records), the
raw `pg_dump` output is **never** uploaded — only an AES256-encrypted copy is.

## What you need

- **The `DB_BACKUP_ENCRYPTION_PASSPHRASE` secret value.** This is the same
  passphrase configured as a GitHub Actions secret
  (Settings → Secrets and variables → Actions →
  `DB_BACKUP_ENCRYPTION_PASSPHRASE`). It is not written down anywhere in this
  repository or in any workflow log — retrieve it from wherever your team stores
  shared secrets (password manager, etc.). If you don't already have it, you
  cannot decrypt existing backups; there is no recovery path around this by
  design.
- `gpg` (GnuPG). Included by default on macOS and most Linux distributions.
  On Windows, install [Gpg4win](https://www.gpg4win.org/) or use GPG via WSL.
- PostgreSQL 17 client tools (`pg_restore`, `psql`) if you intend to inspect or
  restore the dump. The backup is produced with PostgreSQL 17's `pg_dump
  --format=custom`; restoring with an older `pg_restore` may fail or behave
  unexpectedly. Match the major version.

## 1. Download the artifact

1. Go to the repository's **Actions** tab → **Database Backup** workflow →
   select the run you want.
2. Under **Artifacts**, download `wfm-db-backup-YYYYMMDD-HHMMSS`. It contains a
   single file named `wfm-backup-YYYYMMDD-HHMMSS.dump.gpg`.

Only users with read access to the repository's Actions runs can do this. Given
the repository is public, that is effectively any authenticated GitHub user —
treat the *encrypted* artifact as low-sensitivity, but the *passphrase* and the
*decrypted dump* as highly sensitive from the moment you produce them locally.

## 2. Decrypt it locally

**Do not pass the passphrase on the command line** (`--passphrase`) — it would
be visible in your shell history and process list. Let `gpg` prompt for it
interactively instead:

```bash
gpg --output wfm-backup-YYYYMMDD-HHMMSS.dump --decrypt wfm-backup-YYYYMMDD-HHMMSS.dump.gpg
# gpg will prompt for the passphrase interactively
```

This produces the original plaintext `.dump` file. Treat it exactly like the
production database itself — do not commit it, upload it anywhere, or leave it
on a shared machine. Delete it once you're done with it.

## 3. Inspect the dump without restoring anything

To see what's in the dump (table list, object counts) without touching any
database:

```bash
pg_restore --list wfm-backup-YYYYMMDD-HHMMSS.dump
```

This is read-only and safe to run against any decrypted backup file.

## 4. Restore into a controlled/test environment only

```bash
# Example: a local, throwaway PostgreSQL 17 instance
createdb wfm_restore_test
pg_restore --no-owner --no-acl --dbname=wfm_restore_test wfm-backup-YYYYMMDD-HHMMSS.dump
```

**⚠️ Never restore directly into the production database.** This dump contains
a full point-in-time snapshot of `public` schema data — restoring it over a live
database will overwrite or duplicate current records. Always restore into a
local, disposable, or explicitly-designated test database first, and only
promote data to production through a deliberate, reviewed process (see
`docs/DATABASE-RESTORE.md` for the production restore procedure, which is a
separate, intentionally more careful process from local inspection/testing).

## 5. Clean up afterward

Once you're done:

```bash
rm -f wfm-backup-YYYYMMDD-HHMMSS.dump wfm-backup-YYYYMMDD-HHMMSS.dump.gpg
```

The decrypted `.dump` file is the sensitive one — don't leave it lying around
after you're finished.

## Reference: what the workflow guarantees

- The backup workflow (`.github/workflows/db-backup.yml`) fails closed if
  `DB_BACKUP_ENCRYPTION_PASSPHRASE` is not configured — it will not run at all,
  let alone produce an unencrypted artifact.
- The plaintext `pg_dump` output exists only transiently on the GitHub Actions
  runner, for integrity checking and restore-verification against a disposable,
  isolated PostgreSQL service in the same job. It is deleted at the end of the
  job (and would be destroyed with the runner regardless). It is never an input
  to the artifact-upload step.
- Only the `.gpg`-encrypted file is ever uploaded as an artifact, retained for
  90 days.
