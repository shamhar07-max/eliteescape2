import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { saveDocumentFile, readDocumentFile, deleteDocumentFile } from "../lib/documents.js";

export const router = Router();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB — a scanned passport/Emirates ID fits comfortably

const ENTITY_TYPES = ["customer", "employee", "supplier", "traveler", "booking", "visa_document", "other"];

// Which permission a document's entity_type falls under — the same module
// boundaries the rest of the app already enforces (crm/ops/hr/procurement).
const ENTITY_PERMS = {
  customer: "crm",
  booking: "ops",
  traveler: "ops",
  visa_document: "ops",
  employee: "hr",
  supplier: "procurement",
  other: "admin",
};
const permsFor = (entityType, mode) => [`${ENTITY_PERMS[entityType] || "admin"}.${mode}`];

const serializeDocument = (row) => {
  const { storage_path, ...rest } = row;
  return rest; // storage_path never leaves the server — download is the only way to reach the file
};

const documentSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.number().int(),
  documentType: z.enum(["passport", "emirates_id", "visa", "contract", "other"]),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  fileBase64: z.string().min(1),
  expiryDate: z.string().optional(),
  notes: z.string().optional(),
});

router.get("/api/documents", auth(), (req, res) => {
  const { entityType, entityId } = req.query;
  if (!entityType || !entityId) return res.status(400).json({ error: "entityType and entityId are required" });
  if (!req.user.permissions.includes(permsFor(entityType, "read")[0]) && req.user.role !== "owner") {
    return res.status(403).json({ error: "missing permissions", missing: permsFor(entityType, "read") });
  }
  const rows = db.prepare("SELECT * FROM documents WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC").all(entityType, entityId);
  res.json(rows.map(serializeDocument));
});

router.get("/api/documents/expiring", auth(["admin.read"]), (req, res) => {
  const withinDays = Math.min(Number(req.query.withinDays) || 30, 365);
  const rows = db.prepare(`
    SELECT * FROM documents
    WHERE status = 'active' AND expiry_date IS NOT NULL
      AND expiry_date <= date('now', '+' || ? || ' days')
    ORDER BY expiry_date ASC LIMIT 200
  `).all(withinDays);
  res.json(rows.map(serializeDocument));
});

router.post("/api/documents", auth(), (req, res) => {
  const parsed = documentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  if (!req.user.permissions.includes(permsFor(d.entityType, "write")[0]) && req.user.role !== "owner") {
    return res.status(403).json({ error: "missing permissions", missing: permsFor(d.entityType, "write") });
  }

  // Reject oversized payloads before touching disk — base64 is ~4/3 the
  // original byte size, so this is a conservative (slightly generous) check.
  const approxBytes = Math.floor(d.fileBase64.length * 3 / 4);
  if (approxBytes > MAX_UPLOAD_BYTES) return res.status(413).json({ error: "file exceeds 10MB limit" });

  let saved;
  try {
    saved = saveDocumentFile(d.entityType, d.entityId, d.fileName, d.fileBase64);
  } catch {
    return res.status(400).json({ error: "could not decode file content" });
  }

  const result = db.prepare(`
    INSERT INTO documents (entity_type, entity_id, document_type, file_name, mime_type, size_bytes, storage_path, expiry_date, notes, uploaded_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d.entityType, d.entityId, d.documentType, d.fileName, d.mimeType, saved.sizeBytes, saved.storagePath, d.expiryDate || null, d.notes || null, req.user.id);

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'upload', 'document', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, `${d.documentType} for ${d.entityType} #${d.entityId}: ${d.fileName}`);

  res.status(201).json(serializeDocument({
    id: Number(result.lastInsertRowid), entity_type: d.entityType, entity_id: d.entityId, document_type: d.documentType,
    file_name: d.fileName, mime_type: d.mimeType, size_bytes: saved.sizeBytes, expiry_date: d.expiryDate || null,
    status: "active", notes: d.notes || null, uploaded_by_user_id: req.user.id,
  }));
});

router.get("/api/documents/:id/download", auth(), (req, res) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ error: "document not found" });
  if (!req.user.permissions.includes(permsFor(doc.entity_type, "read")[0]) && req.user.role !== "owner") {
    return res.status(403).json({ error: "missing permissions" });
  }
  const buffer = readDocumentFile(doc.storage_path);
  if (!buffer) return res.status(404).json({ error: "file missing from storage" });

  res.setHeader("Content-Type", doc.mime_type);
  res.setHeader("Content-Disposition", `attachment; filename="${doc.file_name.replace(/"/g, "")}"`);
  res.send(buffer);
});

const documentUpdateSchema = z.object({
  status: z.enum(["active", "expired", "archived"]).optional(),
  expiryDate: z.string().optional(),
  notes: z.string().optional(),
});

router.patch("/api/documents/:id", auth(), (req, res) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ error: "document not found" });
  if (!req.user.permissions.includes(permsFor(doc.entity_type, "write")[0]) && req.user.role !== "owner") {
    return res.status(403).json({ error: "missing permissions" });
  }
  const parsed = documentUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const status = parsed.data.status ?? doc.status;
  const expiryDate = parsed.data.expiryDate ?? doc.expiry_date;
  const notes = parsed.data.notes ?? doc.notes;
  db.prepare("UPDATE documents SET status = ?, expiry_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, expiryDate, notes, req.params.id);

  res.json({ id: Number(req.params.id), status, expiryDate, notes });
});

router.delete("/api/documents/:id", auth(), (req, res) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ error: "document not found" });
  if (!req.user.permissions.includes(permsFor(doc.entity_type, "write")[0]) && req.user.role !== "owner") {
    return res.status(403).json({ error: "missing permissions" });
  }
  deleteDocumentFile(doc.storage_path);
  db.prepare("DELETE FROM documents WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'delete', 'document', ?, ?)")
    .run(req.user.id, req.params.id, `${doc.document_type} for ${doc.entity_type} #${doc.entity_id}`);
  res.json({ ok: true });
});
