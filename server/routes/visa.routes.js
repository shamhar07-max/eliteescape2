import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { nextVisaCaseNumber } from "../lib/visaCaseNumber.js";
import { toFils, toAed } from "../lib/money.js";

export const router = Router();

// Never promise approval or invent processing time — the case notes/status
// are the only place time estimates or outcomes should ever appear, and
// only when a human specialist puts them there.
export const VISA_STATUSES = [
  "new", "documents_requested", "documents_received", "internal_review", "ready_for_submission",
  "submitted", "appointment_required", "additional_documents_requested", "under_processing",
  "decision_received", "completed", "rejected", "withdrawn", "cancelled",
];

const serializeCase = (row) => ({ ...row, fee_aed: row.fee_aed_fils === null ? null : toAed(row.fee_aed_fils) });

router.get("/api/visa-cases", auth(["ops.read"]), (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare("SELECT * FROM visa_cases WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
    : db.prepare("SELECT * FROM visa_cases ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows.map(serializeCase));
});

router.get("/api/visa-cases/:id", auth(["ops.read"]), (req, res) => {
  const visaCase = db.prepare("SELECT * FROM visa_cases WHERE id = ?").get(req.params.id);
  if (!visaCase) return res.status(404).json({ error: "visa case not found" });
  const applicants = db.prepare("SELECT * FROM visa_applicants WHERE visa_case_id = ?").all(req.params.id);
  const documents = db.prepare("SELECT * FROM visa_documents WHERE visa_case_id = ? ORDER BY created_at ASC").all(req.params.id);
  const statusHistory = db.prepare(`
    SELECT h.*, u.full_name AS changed_by_name FROM visa_case_status_history h
    LEFT JOIN users u ON u.id = h.changed_by_user_id WHERE h.visa_case_id = ? ORDER BY h.created_at DESC
  `).all(req.params.id);
  res.json({ ...serializeCase(visaCase), applicants, documents, statusHistory });
});

const caseSchema = z.object({
  customerId: z.number().int(),
  leadId: z.number().int().optional(),
  bookingId: z.number().int().optional(),
  destinationCountry: z.string().min(1),
  visaType: z.string().min(1),
  feeAed: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

router.post("/api/visa-cases", auth(["ops.write"]), (req, res) => {
  const parsed = caseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const c = parsed.data;

  const caseNumber = nextVisaCaseNumber();
  const result = db.prepare(`
    INSERT INTO visa_cases (case_number, customer_id, lead_id, booking_id, destination_country, visa_type, fee_aed_fils, notes, responsible_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(caseNumber, c.customerId, c.leadId || null, c.bookingId || null, c.destinationCountry, c.visaType,
    c.feeAed !== undefined ? toFils(c.feeAed) : null, c.notes || null, req.user.id);

  db.prepare("INSERT INTO visa_case_status_history (visa_case_id, status, changed_by_user_id) VALUES (?, 'new', ?)")
    .run(result.lastInsertRowid, req.user.id);
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'visa_case', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, caseNumber);

  res.status(201).json({ id: Number(result.lastInsertRowid), caseNumber, status: "new" });
});

const caseStatusSchema = z.object({ status: z.enum(VISA_STATUSES), note: z.string().optional() });

router.patch("/api/visa-cases/:id/status", auth(["ops.write"]), (req, res) => {
  const parsed = caseStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const visaCase = db.prepare("SELECT id FROM visa_cases WHERE id = ?").get(req.params.id);
  if (!visaCase) return res.status(404).json({ error: "visa case not found" });

  db.prepare("UPDATE visa_cases SET status = ?, updated_at = datetime('now') WHERE id = ?").run(parsed.data.status, req.params.id);
  db.prepare("INSERT INTO visa_case_status_history (visa_case_id, status, changed_by_user_id, note) VALUES (?, ?, ?, ?)")
    .run(req.params.id, parsed.data.status, req.user.id, parsed.data.note || null);

  res.json({ id: Number(req.params.id), status: parsed.data.status });
});

const applicantSchema = z.object({
  fullName: z.string().min(1),
  passportNumber: z.string().optional(),
  passportExpiry: z.string().optional(),
  nationality: z.string().optional(),
  dateOfBirth: z.string().optional(),
});

router.post("/api/visa-cases/:id/applicants", auth(["ops.write"]), (req, res) => {
  const parsed = applicantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const visaCase = db.prepare("SELECT id FROM visa_cases WHERE id = ?").get(req.params.id);
  if (!visaCase) return res.status(404).json({ error: "visa case not found" });

  const a = parsed.data;
  const result = db.prepare(`
    INSERT INTO visa_applicants (visa_case_id, full_name, passport_number, passport_expiry, nationality, date_of_birth)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, a.fullName, a.passportNumber || null, a.passportExpiry || null, a.nationality || null, a.dateOfBirth || null);

  res.status(201).json({ id: Number(result.lastInsertRowid), visaCaseId: Number(req.params.id), ...a });
});

const documentSchema = z.object({
  applicantId: z.number().int().optional(),
  documentType: z.string().min(1),
  notes: z.string().optional(),
});

router.post("/api/visa-cases/:id/documents", auth(["ops.write"]), (req, res) => {
  const parsed = documentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const visaCase = db.prepare("SELECT id FROM visa_cases WHERE id = ?").get(req.params.id);
  if (!visaCase) return res.status(404).json({ error: "visa case not found" });

  const d = parsed.data;
  const result = db.prepare("INSERT INTO visa_documents (visa_case_id, applicant_id, document_type, notes) VALUES (?, ?, ?, ?)")
    .run(req.params.id, d.applicantId || null, d.documentType, d.notes || null);

  res.status(201).json({ id: Number(result.lastInsertRowid), visaCaseId: Number(req.params.id), status: "requested", ...d });
});

const documentStatusSchema = z.object({ status: z.enum(["requested", "received", "rejected"]) });

router.patch("/api/visa-documents/:id/status", auth(["ops.write"]), (req, res) => {
  const parsed = documentStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const document = db.prepare("SELECT id FROM visa_documents WHERE id = ?").get(req.params.id);
  if (!document) return res.status(404).json({ error: "document not found" });

  db.prepare("UPDATE visa_documents SET status = ?, updated_at = datetime('now') WHERE id = ?").run(parsed.data.status, req.params.id);
  res.json({ id: Number(req.params.id), status: parsed.data.status });
});
