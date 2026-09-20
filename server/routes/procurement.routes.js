import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { nextPoNumber } from "../lib/poNumber.js";
import { notifyRole } from "../lib/notify.js";
import { toFils, toAed } from "../lib/money.js";

export const router = Router();

const serializePo = (row) => ({ ...row, amount_aed: toAed(row.amount_aed_fils) });

const vendorSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  category: z.enum(["transport", "hotel", "office_supplies", "marketing", "other"]).default("other"),
});

router.get("/api/vendors", auth(["procurement.read"]), (req, res) => {
  res.json(db.prepare("SELECT * FROM vendors ORDER BY name ASC").all());
});

router.post("/api/vendors", auth(["procurement.write"]), (req, res) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const v = parsed.data;

  const result = db.prepare(
    "INSERT INTO vendors (name, contact_name, email, phone, category) VALUES (?, ?, ?, ?, ?)"
  ).run(v.name, v.contactName || null, v.email || null, v.phone || null, v.category);

  res.status(201).json({ id: Number(result.lastInsertRowid), ...v });
});

const poSchema = z.object({
  vendorId: z.number().int(),
  description: z.string().min(1),
  amountAed: z.number().positive(),
});

router.get("/api/purchase-orders", auth(["procurement.read"]), (req, res) => {
  const { status } = req.query;
  const base = `
    SELECT po.*, v.name AS vendor_name FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
  `;
  const rows = status
    ? db.prepare(`${base} WHERE po.status = ? ORDER BY po.created_at DESC LIMIT 200`).all(status)
    : db.prepare(`${base} ORDER BY po.created_at DESC LIMIT 200`).all();
  res.json(rows.map(serializePo));
});

router.get("/api/purchase-orders/:id", auth(["procurement.read"]), (req, res) => {
  const po = db.prepare(`
    SELECT po.*, v.name AS vendor_name FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id WHERE po.id = ?
  `).get(req.params.id);
  if (!po) return res.status(404).json({ error: "purchase order not found" });
  res.json(serializePo(po));
});

router.post("/api/purchase-orders", auth(["procurement.write"]), async (req, res) => {
  const parsed = poSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const p = parsed.data;

  const vendor = db.prepare("SELECT name FROM vendors WHERE id = ?").get(p.vendorId);
  if (!vendor) return res.status(404).json({ error: "vendor not found" });

  const poNumber = nextPoNumber();
  const result = db.prepare(
    "INSERT INTO purchase_orders (po_number, vendor_id, description, amount_aed_fils, requested_by_user_id) VALUES (?, ?, ?, ?, ?)"
  ).run(poNumber, p.vendorId, p.description, toFils(p.amountAed), req.user.id);

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'purchase_order', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, poNumber);

  await notifyRole(["owner", "admin"], {
    type: "system",
    title: `PO awaiting approval: ${poNumber}`,
    body: `${vendor.name} — AED ${p.amountAed} — ${p.description}`,
    entityType: "purchase_order",
    entityId: Number(result.lastInsertRowid),
  });

  res.status(201).json({ id: Number(result.lastInsertRowid), poNumber, ...p, status: "draft" });
});

const poStatusSchema = z.object({ status: z.enum(["draft", "approved", "received", "paid", "cancelled"]) });

router.patch("/api/purchase-orders/:id/status", auth(["procurement.write"]), (req, res) => {
  const parsed = poStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const po = db.prepare("SELECT id FROM purchase_orders WHERE id = ?").get(req.params.id);
  if (!po) return res.status(404).json({ error: "purchase order not found" });

  const approvedByClause = parsed.data.status === "approved" ? ", approved_by_user_id = ?" : "";
  const params = parsed.data.status === "approved" ? [parsed.data.status, req.user.id, req.params.id] : [parsed.data.status, req.params.id];
  db.prepare(`UPDATE purchase_orders SET status = ?${approvedByClause}, updated_at = datetime('now') WHERE id = ?`).run(...params);

  res.json({ id: Number(req.params.id), status: parsed.data.status });
});
