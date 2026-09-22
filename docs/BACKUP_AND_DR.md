# Backups & Disaster Recovery

Implements master spec §66 (Backups): "Automated DB + file backups, encryption,
retention rules, restore testing, disaster recovery procedure. Not 'complete'
until restore tests actually pass."

## What gets backed up

Every backup bundles two things as of the same instant:

1. **The SQLite database** — snapshotted with `node:sqlite`'s own `backup()`
   API (`server/lib/backup.js`), never a raw file copy. A raw copy of a live
   WAL-mode database can catch a page mid-write; the SQLite backup API is
   the correct, WAL-safe way to get a consistent snapshot without stopping
   the server.
2. **The local document store** (`server/data/documents/` — passports,
   Emirates IDs, contracts, etc. from the document management module).

Both are tarred into one `backup-<timestamp>.tar` file, alongside a
`.json` manifest recording its SHA-256 checksum, size, and encryption
status.

## Encryption

Set `BACKUP_ENCRYPTION_KEY` (any non-empty passphrase) in the environment
before running a backup. When set, the tar bundle is encrypted with
AES-256-GCM (key derived via scrypt) before being written to disk, and the
manifest records `encrypted: true`. **When unset, backups are stored in
plaintext** — the app makes no attempt to hide this; the dashboard's
Backups panel and the CLI script both print a warning. Plaintext is
acceptable for local development only. Production deployments must set
`BACKUP_ENCRYPTION_KEY` (a secrets manager value, never committed).

The passphrase itself is never stored anywhere by this app — losing it
means losing the ability to restore any encrypted backup made with it.
Keep it in the same secrets manager as the rest of production config, with
its own access-controlled backup.

## Retention

The newest `BACKUP_RETENTION_COUNT` backups are kept (default 7); older
ones are deleted automatically after each successful backup run. This is
a simple fixed-count policy — a production deployment with compliance
retention requirements (e.g. "7 daily + 4 weekly + 12 monthly") should
extend `applyRetention()` in `server/lib/backup.js` rather than relying on
external tooling to prune this app's backup directory.

## Where backups live

Local disk under `server/data/backups/` (or `BACKUP_DIR` if set) by
default — consistent with how this app already stores its SQLite DB and
uploaded documents (see `docs/ELITE_ESCAPE_INTEGRATION_MAP.md`). This
sandbox has no cloud storage credentials to integrate against, so nothing
here fakes an S3/GCS upload. A real production deployment should point
`BACKUP_DIR` at a separate mounted volume (never the same disk as the live
DB — a disk failure should not take out both) or add an upload step at the
end of `createBackup()` in `server/lib/backup.js` once real cloud
credentials exist.

## Restore testing — the part that makes this real

`server/lib/backup.js`'s `runRestoreTest()` is the actual disaster-recovery
drill:

1. Creates a fresh backup.
2. Restores it into an isolated temporary directory (never the live data
   directory — a restore test can never corrupt production data).
3. Runs `PRAGMA integrity_check` on the restored database.
4. Compares row counts for `customers`, `bookings`, `invoices`, `leads`,
   `journal_entries`, and `documents` between the live DB and the restored
   one.
5. Compares the restored document file count against the live one.
6. Deletes the temporary restore directory.

Run it any time with `node scripts/restore-test.js` (exits non-zero on
failure), from the **Platform Admin → Backups & disaster recovery** panel
in the dashboard, or via `POST /api/admin/backups/restore-test`. **It also
runs on every CI push** (`.github/workflows/ci.yml`), so a restore that
silently stops working fails the build instead of surfacing for the first
time during a real incident.

## Disaster recovery procedure

1. Stop the application (`docker compose down` or stop the `node index.js`
   process) so nothing writes to the DB during restore.
2. Pick the backup to restore from `server/data/backups/` (or wherever
   `BACKUP_DIR` points) — each has a `.json` manifest with its timestamp.
3. Run `restoreBackup(fileName, { targetDir: <somewhere new> })` from
   `server/lib/backup.js` (or adapt `scripts/restore-test.js`, which calls
   the same function) to decrypt, verify the checksum, and extract it.
4. Copy the restored `elite-escape.db` to the path `DB_PATH` points at,
   and the restored `documents/` tree to `server/data/documents/`.
5. Start the application and confirm `/api/health` responds, then spot-check
   a few real records (a recent invoice, a recent booking) against what the
   business expects.
6. Record the incident and the restore point used in the audit log context
   (who ran it, when, why) — this is exactly the kind of event
   `docs/ELITE_ESCAPE_SECURITY_MODEL.md`'s audit trail exists for.

## What this doesn't cover yet

- **Off-host storage**: backups currently live on the same host as the
  live app. A real production deployment needs `BACKUP_DIR` on separate
  physical/cloud storage — scaffolded (`BACKUP_DIR` env var) but not
  implemented, since no cloud storage credentials exist in this
  environment to integrate against honestly.
- **Scheduling**: nothing in this repo cron-schedules `scripts/backup.js`.
  GitHub Actions cannot do this for a self-hosted production database (it
  has no network path to it) — schedule it on the host itself via cron or
  a systemd timer, e.g. `0 2 * * * cd /app/server && node scripts/backup.js`.
