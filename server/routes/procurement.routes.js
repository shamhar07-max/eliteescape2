import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { nextPoNumber } from "../lib/poNumber.js";
import { notifyRole } from "../lib/notify.js";
import { toFils, toAed } from "../lib/money.js";
import { postJournalEntry, ACCOUNTS } from "../lib/gl.js";

export const router = Router();

const serializePo = (row) => ({ ...row, amount_aed: toAed(row.amount_aed_fils) });
const serializeRate = (row) => ({ ...row, cost_aed: toAed(row.cost_aed_fils) });

// Travel-specific supplier categories per the master spec's Supplier
// Management section, plus the original procurement categories so vendors
// seeded by earlier phases stay valid.
const SUPPLIER_CATEGORIES = [
  "airline", "hotel", "dmc", "tour_operator", "visa_partner", "transfer_company", "attraction_supplier", "insurance_company",
  "transport", "office_supplies", "marketing", "other",
];

// No .default() here on purpose: vendorSchema.partial() is reused for PATCH
// below, and zod's .partial() does not clear a field's .default() — an
// absent key would silently resolve to the default and overwrite the
// existing value. Defaults for create are applied explicitly in the POST
// handler instead.
const vendorSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  category: z.enum(SUPPLIER_CATEGORIES).optional(),
  trn: z.string().optional(),
  currency: z.string().length(3).optional(),
  paymentTerms: z.string().optional(),
  contractStart: z.string().optional(),
  contractEnd: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  notes: z.string().optional(),
});

router.get("/api/vendors", auth(["procurement.read"]), (req, res) => {
  const { category, status } = req.query;
  let sql = "SELECT * FROM vendors WHERE 1=1";
  const params = [];
  if (category) { sql += " AND category = ?"; params.push(category); }
  if (status) { sql += " AND status = ?"; params.push(status); }
  res.json(db.prepare(`${sql} ORDER BY name ASC`).all(...params));
});

router.get("/api/vendors/:id", auth(["procurement.read"]), (req, res) => {
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "vendor not found" });
  const contacts = db.prepare("SELECT * FROM supplier_contacts WHERE vendor_id = ? ORDER BY is_primary DESC, name ASC").all(req.params.id);
  const rates = db.prepare("SELECT * FROM supplier_rates WHERE vendor_id = ? ORDER BY created_at DESC").all(req.params.id);
  res.json({ ...vendor, contacts, rates: rates.map(serializeRate) });
});

router.post("/api/vendors", auth(["procurement.write"]), (req, res) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const v = parsed.data;
  const category = v.category || "other";
  const currency = v.currency || "AED";

  const result = db.prepare(`
    INSERT INTO vendors (name, contact_name, email, phone, category, trn, currency, payment_terms, contract_start, contract_end, address, website, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(v.name, v.contactName || null, v.email || null, v.phone || null, category, v.trn || null, currency,
    v.paymentTerms || null, v.contractStart || null, v.contractEnd || null, v.address || null, v.website || null, v.notes || null);

  res.status(201).json({ id: Number(result.lastInsertRowid), ...v, category, currency });
});

router.patch("/api/vendors/:id", auth(["procurement.write"]), (req, res) => {
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "vendor not found" });
  const parsed = vendorSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const v = parsed.data;

  const merged = {
    name: v.name ?? vendor.name, contact_name: v.contactName ?? vendor.contact_name,
    email: v.email ?? vendor.email, phone: v.phone ?? vendor.phone, category: v.category ?? vendor.category,
    trn: v.trn ?? vendor.trn, currency: v.currency ?? vendor.currency, payment_terms: v.paymentTerms ?? vendor.payment_terms,
    contract_start: v.contractStart ?? vendor.contract_start, contract_end: v.contractEnd ?? vendor.contract_end,
    address: v.address ?? vendor.address, website: v.website ?? vendor.website, notes: v.notes ?? vendor.notes,
  };
  db.prepare(`
    UPDATE vendors SET name = ?, contact_name = ?, email = ?, phone = ?, category = ?, trn = ?, currency = ?,
      payment_terms = ?, contract_start = ?, contract_end = ?, address = ?, website = ?, notes = ? WHERE id = ?
  `).run(...Object.values(merged), req.params.id);

  res.json({ id: Number(req.params.id), ...merged });
});

const vendorStatusSchema = z.object({ status: z.enum(["active", "inactive"]) });

router.patch("/api/vendors/:id/status", auth(["procurement.write"]), (req, res) => {
  const parsed = vendorStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const vendor = db.prepare("SELECT id FROM vendors WHERE id = ?").get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "vendor not found" });
  db.prepare("UPDATE vendors SET status = ? WHERE id = ?").run(parsed.data.status, req.params.id);
  res.json({ id: Number(req.params.id), status: parsed.data.status });
});

// ===== Supplier contacts =====
const contactSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  isPrimary: z.boolean().default(false),
});

router.post("/api/vendors/:id/contacts", auth(["procurement.write"]), (req, res) => {
  const vendor = db.prepare("SELECT id FROM vendors WHERE id = ?").get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "vendor not found" });
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const c = parsed.data;

  const result = db.prepare(
    "INSERT INTO supplier_contacts (vendor_id, name, role, email, phone, is_primary) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(req.params.id, c.name, c.role || null, c.email || null, c.phone || null, c.isPrimary ? 1 : 0);

  res.status(201).json({ id: Number(result.lastInsertRowid), vendorId: Number(req.params.id), ...c });
});

router.delete("/api/supplier-contacts/:id", auth(["procurement.write"]), (req, res) => {
  const contact = db.prepare("SELECT id FROM supplier_contacts WHERE id = ?").get(req.params.id);
  if (!contact) return res.status(404).json({ error: "contact not found" });
  db.prepare("DELETE FROM supplier_contacts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ===== Supplier rate cards =====
const rateSchema = z.object({
  serviceType: z.enum(["holiday", "flight", "hotel", "visa", "transfer", "attraction", "insurance", "other"]),
  description: z.string().min(1),
  costAed: z.number().nonnegative(),
  currency: z.string().length(3).default("AED"),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/api/vendors/:id/rates", auth(["procurement.write"]), (req, res) => {
  const vendor = db.prepare("SELECT id FROM vendors WHERE id = ?").get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "vendor not found" });
  const parsed = rateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const r = parsed.data;

  const result = db.prepare(
    "INSERT INTO supplier_rates (vendor_id, service_type, description, cost_aed_fils, currency, valid_from, valid_to, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(req.params.id, r.serviceType, r.description, toFils(r.costAed), r.currency, r.validFrom || null, r.validTo || null, r.notes || null);

  res.status(201).json({ id: Number(result.lastInsertRowid), vendorId: Number(req.params.id), ...r });
});

router.delete("/api/supplier-rates/:id", auth(["procurement.write"]), (req, res) => {
  const rate = db.prepare("SELECT id FROM supplier_rates WHERE id = ?").get(req.params.id);
  if (!rate) return res.status(404).json({ error: "rate not found" });
  db.prepare("DELETE FROM supplier_rates WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ===== Supplier performance =====
// Computed from existing data rather than tracked separately: spend and
// bill count from purchase_orders, services actually fulfilled from
// booking_items (which already carries supplier_id + supplier_cost),
// refund count/amount from refunds against this supplier's POs.
router.get("/api/vendors/:id/performance", auth(["procurement.read"]), (req, res) => {
  const vendor = db.prepare("SELECT id, name FROM vendors WHERE id = ?").get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "vendor not found" });

  const poStats = db.prepare(`
    SELECT COUNT(*) AS poCount, COALESCE(SUM(amount_aed_fils), 0) AS totalSpentFils,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelledCount
    FROM purchase_orders WHERE vendor_id = ?
  `).get(req.params.id);

  const serviceStats = db.prepare(`
    SELECT COUNT(*) AS serviceCount, COALESCE(SUM(quantity * supplier_cost_aed_fils), 0) AS totalCostFils
    FROM booking_items WHERE supplier_id = ?
  `).get(req.params.id);

  const refundStats = db.prepare(`
    SELECT COUNT(*) AS refundCount, COALESCE(SUM(r.amount_aed_fils), 0) AS totalRefundedFils
    FROM refunds r JOIN purchase_orders po ON po.id = r.purchase_order_id
    WHERE po.vendor_id = ? AND r.status = 'paid'
  `).get(req.params.id);

  res.json({
    vendorId: vendor.id, vendorName: vendor.name,
    purchaseOrders: { count: poStats.poCount, cancelledCount: poStats.cancelledCount, totalSpentAed: toAed(poStats.totalSpentFils) },
    servicesFulfilled: { count: serviceStats.serviceCount, totalCostAed: toAed(serviceStats.totalCostFils) },
    refunds: { count: refundStats.refundCount, totalRefundedAed: toAed(refundStats.totalRefundedFils) },
  });
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
  const po = db.prepare(`
    SELECT po.*, v.name AS vendor_name FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id WHERE po.id = ?
  `).get(req.params.id);
  if (!po) return res.status(404).json({ error: "purchase order not found" });
  if (parsed.data.status === "received" && po.status !== "approved") {
    return res.status(409).json({ error: "only an approved purchase order can be marked received" });
  }
  if (parsed.data.status === "paid" && po.status !== "received") {
    return res.status(409).json({ error: "only a received purchase order can be marked paid" });
  }

  const approvedByClause = parsed.data.status === "approved" ? ", approved_by_user_id = ?" : "";
  const params = parsed.data.status === "approved" ? [parsed.data.status, req.user.id, req.params.id] : [parsed.data.status, req.params.id];
  db.prepare(`UPDATE purchase_orders SET status = ?${approvedByClause}, updated_at = datetime('now') WHERE id = ?`).run(...params);

  // 'received' books the supplier's bill as a payable; 'paid' clears it —
  // distinct source_type strings so both post exactly once against the
  // same PO id.
  if (parsed.data.status === "received") {
    postJournalEntry({
      memo: `Bill received: ${po.po_number} — ${po.vendor_name}`,
      sourceType: "purchase_order_received",
      sourceId: po.id,
      userId: req.user.id,
      lines: [
        { accountCode: ACCOUNTS.SUPPLIER_COST, debitFils: po.amount_aed_fils, description: po.po_number },
        { accountCode: ACCOUNTS.ACCOUNTS_PAYABLE, creditFils: po.amount_aed_fils, description: po.po_number },
      ],
    });
  }
  if (parsed.data.status === "paid") {
    postJournalEntry({
      memo: `Bill paid: ${po.po_number} — ${po.vendor_name}`,
      sourceType: "purchase_order_paid",
      sourceId: po.id,
      userId: req.user.id,
      lines: [
        { accountCode: ACCOUNTS.ACCOUNTS_PAYABLE, debitFils: po.amount_aed_fils, description: po.po_number },
        { accountCode: ACCOUNTS.BANK, creditFils: po.amount_aed_fils, description: po.po_number },
      ],
    });
  }

  res.json({ id: Number(req.params.id), status: parsed.data.status });
});
