import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, unlinkSync, rmSync,
} from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dbPath } from "../db.js";
import { DOCUMENTS_ROOT } from "./documents.js";

const root = dirname(fileURLToPath(import.meta.url));
export const BACKUP_ROOT = process.env.BACKUP_DIR || join(root, "..", "data", "backups");
const RETENTION_COUNT = Number(process.env.BACKUP_RETENTION_COUNT || 7);
const SALT = "elite-escape-backup-v1"; // fixed salt is fine here: the secret is the passphrase (BACKUP_ENCRYPTION_KEY), not the salt

/* AES-256-GCM over the whole file in memory — simpler and just as correct
 * as streaming for backup sizes this app produces (a SQLite dev DB + local
 * document store), and it avoids the finalize-after-pipe-ends complexity
 * streaming GCM requires to append the auth tag correctly. */
const deriveKey = (passphrase) => scryptSync(passphrase, SALT, 32);

function encryptBuffer(buffer, passphrase) {
  const key = deriveKey(passphrase);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); // 12-byte IV + 16-byte tag + ciphertext
}

function decryptBuffer(buffer, passphrase) {
  const key = deriveKey(passphrase);
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

const countFilesRecursive = (dir) => {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).length;
};

/* Creates one backup: a WAL-safe SQLite snapshot (via node:sqlite's own
 * backup() API — NOT a raw file copy, which could catch a page mid-write)
 * plus the local document store, tarred together and optionally encrypted.
 * Applies retention (keep the newest N) after every run. */
export async function createBackup({ label } = {}) {
  mkdirSync(BACKUP_ROOT, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const workDir = join(BACKUP_ROOT, `.work-${timestamp}`);
  mkdirSync(workDir, { recursive: true });

  try {
    const sourceDb = new DatabaseSync(dbPath, { readOnly: true });
    await sqliteBackup(sourceDb, join(workDir, "elite-escape.db"));
    sourceDb.close();

    const docsSnapshotPath = join(workDir, "documents");
    if (existsSync(DOCUMENTS_ROOT)) execFileSync("cp", ["-r", DOCUMENTS_ROOT, docsSnapshotPath]);
    else mkdirSync(docsSnapshotPath, { recursive: true });

    const tarPath = join(BACKUP_ROOT, `backup-${timestamp}.tar`);
    execFileSync("tar", ["-cf", tarPath, "-C", workDir, "elite-escape.db", "documents"]);
    const tarBuffer = readFileSync(tarPath);
    const checksumSha256 = createHash("sha256").update(tarBuffer).digest("hex");

    let finalPath = tarPath;
    let encrypted = false;
    const passphrase = process.env.BACKUP_ENCRYPTION_KEY;
    if (passphrase) {
      finalPath = `${tarPath}.enc`;
      writeFileSync(finalPath, encryptBuffer(tarBuffer, passphrase));
      unlinkSync(tarPath);
      encrypted = true;
    }

    const manifest = {
      fileName: basename(finalPath),
      createdAt: new Date().toISOString(),
      sizeBytes: statSync(finalPath).size,
      checksumSha256, // always the checksum of the *decrypted* tar, so restore can verify content regardless of encryption
      encrypted,
      label: label || null,
    };
    writeFileSync(`${finalPath}.json`, JSON.stringify(manifest, null, 2));

    applyRetention();
    return manifest;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function applyRetention() {
  const manifests = listBackups();
  const toDelete = manifests.slice(RETENTION_COUNT);
  for (const m of toDelete) {
    const dataFile = join(BACKUP_ROOT, m.fileName);
    if (existsSync(dataFile)) unlinkSync(dataFile);
    const manifestFile = join(BACKUP_ROOT, `${m.fileName}.json`);
    if (existsSync(manifestFile)) unlinkSync(manifestFile);
  }
  return { kept: manifests.length - toDelete.length, deleted: toDelete.length };
}

export function listBackups() {
  mkdirSync(BACKUP_ROOT, { recursive: true });
  return readdirSync(BACKUP_ROOT)
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(join(BACKUP_ROOT, f), "utf8")))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* Decrypts (if needed), verifies the checksum, and extracts a backup into
 * targetDir (a fresh temp dir by default — never the live data dir, so a
 * restore-test run can never clobber production data). */
export function restoreBackup(fileName, { targetDir, passphrase } = {}) {
  const filePath = join(BACKUP_ROOT, fileName);
  if (!existsSync(filePath)) throw new Error(`backup file not found: ${fileName}`);
  const manifestPath = `${filePath}.json`;
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;

  let tarBuffer = readFileSync(filePath);
  if (manifest?.encrypted) {
    const key = passphrase || process.env.BACKUP_ENCRYPTION_KEY;
    if (!key) throw new Error("this backup is encrypted — set BACKUP_ENCRYPTION_KEY or pass a passphrase");
    tarBuffer = decryptBuffer(tarBuffer, key);
  }
  if (manifest && createHash("sha256").update(tarBuffer).digest("hex") !== manifest.checksumSha256) {
    throw new Error("checksum mismatch — backup file may be corrupted or tampered with");
  }

  const restoreDir = targetDir || join(BACKUP_ROOT, `.restore-${Date.now()}`);
  mkdirSync(restoreDir, { recursive: true });
  const tmpTar = join(restoreDir, "_bundle.tar");
  writeFileSync(tmpTar, tarBuffer);
  execFileSync("tar", ["-xf", tmpTar, "-C", restoreDir]);
  unlinkSync(tmpTar);

  return { restoreDir, dbPath: join(restoreDir, "elite-escape.db"), documentsPath: join(restoreDir, "documents") };
}

/* The actual disaster-recovery drill: back up, restore into an isolated
 * temp dir, verify SQLite integrity and that every row/file made it across,
 * then clean up. This is what makes "backups" a real claim instead of an
 * unverified assumption — see docs/BACKUP_AND_DR.md. */
export async function runRestoreTest() {
  const manifest = await createBackup({ label: "restore-test" });
  const { restoreDir, dbPath: restoredDbPath, documentsPath: restoredDocsPath } = restoreBackup(manifest.fileName);

  const steps = [];
  const step = (name, ok, detail) => steps.push({ name, ok, detail: String(detail) });

  try {
    const restoredDb = new DatabaseSync(restoredDbPath, { readOnly: true });
    const integrity = restoredDb.prepare("PRAGMA integrity_check").get().integrity_check;
    step("sqlite integrity_check", integrity === "ok", integrity);

    const liveDb = new DatabaseSync(dbPath, { readOnly: true });
    for (const table of ["customers", "bookings", "invoices", "leads", "journal_entries", "documents"]) {
      const liveCount = liveDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      const restoredCount = restoredDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      step(`row count matches: ${table}`, liveCount === restoredCount, `${restoredCount}/${liveCount}`);
    }
    liveDb.close();
    restoredDb.close();

    const liveDocsCount = countFilesRecursive(DOCUMENTS_ROOT);
    const restoredDocsCount = countFilesRecursive(restoredDocsPath);
    step("document files match", liveDocsCount === restoredDocsCount, `${restoredDocsCount}/${liveDocsCount}`);
  } finally {
    rmSync(restoreDir, { recursive: true, force: true });
  }

  return { ranAt: new Date().toISOString(), backupFile: manifest.fileName, pass: steps.every(s => s.ok), steps };
}
