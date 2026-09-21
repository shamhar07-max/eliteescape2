import { mkdirSync, writeFileSync, unlinkSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = dirname(fileURLToPath(import.meta.url));
// Deliberately NOT under web/ — app.js only serves web/ as static, so this
// tree is unreachable except through the authenticated download route.
export const DOCUMENTS_ROOT = join(root, "..", "data", "documents");

const sanitizeFileName = (name) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);

/* Saves a base64-decoded upload to disk under entityType/entityId/, with a
 * random prefix so two uploads with the same original name never collide.
 * Returns the path stored in documents.storage_path — relative, so moving
 * DOCUMENTS_ROOT (e.g. to a mounted volume) never breaks old rows. */
export function saveDocumentFile(entityType, entityId, fileName, base64Content) {
  const buffer = Buffer.from(base64Content, "base64");
  const dir = join(DOCUMENTS_ROOT, entityType, String(entityId));
  mkdirSync(dir, { recursive: true });
  const storedName = `${randomUUID()}-${sanitizeFileName(fileName)}`;
  const fullPath = join(dir, storedName);
  writeFileSync(fullPath, buffer);
  return { storagePath: join(entityType, String(entityId), storedName), sizeBytes: buffer.length };
}

export function readDocumentFile(storagePath) {
  const fullPath = join(DOCUMENTS_ROOT, storagePath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath);
}

export function deleteDocumentFile(storagePath) {
  const fullPath = join(DOCUMENTS_ROOT, storagePath);
  if (existsSync(fullPath)) unlinkSync(fullPath);
}
