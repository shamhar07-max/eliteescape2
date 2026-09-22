#!/usr/bin/env node
/* Run manually (`node scripts/backup.js`) or on a schedule via cron/systemd
 * timer on the host running the database — see docs/BACKUP_AND_DR.md.
 * GitHub Actions cannot run this against production: it has no network
 * path to a self-hosted DB file, so scheduling belongs on the host itself. */
import { createBackup } from "../lib/backup.js";

const manifest = await createBackup();
console.log(`[backup] ${manifest.fileName} — ${manifest.sizeBytes} bytes, encrypted=${manifest.encrypted}`);
if (!manifest.encrypted) {
  console.warn("[backup] WARNING: BACKUP_ENCRYPTION_KEY is not set — this backup is stored in plaintext. Fine for local dev only.");
}
