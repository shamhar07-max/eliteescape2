import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { toFils, toAed } from "../lib/money.js";

export const router = Router();

const serializeLead = (row) => ({ ...row, budget_aed: row.budget_aed_fils === null ? null : toAed(row.budget_aed_fils) });

const customerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  nationality: z.string().optional(),
  source: z.enum(["website", "whatsapp", "referral", "walk-in"]).default("website"),
  notes: z.string().optional(),
});

router.get("/api/customers", auth(["crm.read"]), (req, res) => {
  const rows = db.prepare("SELECT * FROM customers ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows);
});

router.post("/api/customers", auth(["crm.write"]), (req, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const c = parsed.data;
  const result = db.prepare(
    "INSERT INTO customers (full_name, email, phone, whatsapp, nationality, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(c.fullName, c.email || null, c.phone || null, c.whatsapp || null, c.nationality || null, c.source, c.notes || null);
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id) VALUES (?, 'create', 'customer', ?)")
    .run(req.user.id, result.lastInsertRowid);
  res.status(201).json({ id: Number(result.lastInsertRowid), ...c });
});

const leadSchema = z.object({
  customerId: z.number().int().optional(),
  interestType: z.enum(["holiday", "visa", "attraction", "flight", "hotel", "insurance"]),
  interestDetail: z.string().optional(),
  budgetAed: z.number().optional(),
  travelDate: z.string().optional(),
});

router.get("/api/leads", auth(["crm.read"]), (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare("SELECT * FROM leads WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
    : db.prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows.map(serializeLead));
});

router.post("/api/leads", auth(["crm.write"]), (req, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const l = parsed.data;
  const result = db.prepare(
    "INSERT INTO leads (customer_id, interest_type, interest_detail, owner_user_id, budget_aed_fils, travel_date) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(l.customerId || null, l.interestType, l.interestDetail || null, req.user.id, l.budgetAed !== undefined ? toFils(l.budgetAed) : null, l.travelDate || null);
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id) VALUES (?, 'create', 'lead', ?)")
    .run(req.user.id, result.lastInsertRowid);
  res.status(201).json({ id: Number(result.lastInsertRowid), ...l, status: "new" });
});

const statusSchema = z.object({ status: z.enum(["new", "contacted", "quoted", "won", "lost"]) });

router.patch("/api/leads/:id/status", auth(["crm.write"]), (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const lead = db.prepare("SELECT id FROM leads WHERE id = ?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "lead not found" });

  db.prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(parsed.data.status, req.params.id);
  db.prepare("INSERT INTO lead_activities (lead_id, actor_user_id, channel, body) VALUES (?, ?, 'note', ?)")
    .run(req.params.id, req.user.id, `Status changed to ${parsed.data.status}`);
  res.json({ id: Number(req.params.id), status: parsed.data.status });
});

router.post("/api/leads/:id/activities", auth(["crm.write"]), (req, res) => {
  const { channel, body } = req.body || {};
  if (!channel || !body) return res.status(400).json({ error: "channel and body required" });
  const lead = db.prepare("SELECT id FROM leads WHERE id = ?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "lead not found" });

  const result = db.prepare("INSERT INTO lead_activities (lead_id, actor_user_id, channel, body) VALUES (?, ?, ?, ?)")
    .run(req.params.id, req.user.id, channel, body);
  res.status(201).json({ id: Number(result.lastInsertRowid), leadId: Number(req.params.id), channel, body });
});

router.get("/api/leads/:id/activities", auth(["crm.read"]), (req, res) => {
  const rows = db.prepare("SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY created_at ASC").all(req.params.id);
  res.json(rows);
});
