import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { nextQuotationNumber } from "../lib/quotationNumber.js";
import { toFils, toAed } from "../lib/money.js";

export const router = Router();

const serializeQuotation = (row) => ({
  ...row,
  subtotal_aed: toAed(row.subtotal_aed_fils),
  discount_aed: toAed(row.discount_aed_fils),
  service_fee_aed: toAed(row.service_fee_aed_fils),
  total_aed: toAed(row.total_aed_fils),
});
const serializeItem = (row) => ({
  ...row,
  unit_cost_aed: toAed(row.unit_cost_aed_fils),
  unit_price_aed: toAed(row.unit_price_aed_fils),
  line_total_aed: toAed(row.line_total_aed_fils),
});

const itemSchema = z.object({
  serviceType: z.enum(["holiday", "flight", "hotel", "transfer", "attraction", "visa", "insurance"]),
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitCostAed: z.number().nonnegative().default(0),
  unitPriceAed: z.number().nonnegative(),
});

const quotationSchema = z.object({
  leadId: z.number().int().optional(),
  customerId: z.number().int(),
  validUntil: z.string().optional(),
  paymentTerms: z.string().optional(),
  inclusions: z.string().optional(),
  exclusions: z.string().optional(),
  cancellationTerms: z.string().optional(),
  discountAed: z.number().nonnegative().default(0),
  serviceFeeAed: z.number().nonnegative().default(0),
  items: z.array(itemSchema).min(1),
});

const computeTotals = (items, discountAed, serviceFeeAed) => {
  const itemFils = items.map(i => ({ ...i, lineTotalFils: Math.round(i.quantity * toFils(i.unitPriceAed)) }));
  const subtotalFils = itemFils.reduce((sum, i) => sum + i.lineTotalFils, 0);
  const totalFils = subtotalFils - toFils(discountAed) + toFils(serviceFeeAed);
  return { itemFils, subtotalFils, totalFils };
};

// Latest version of each quotation (by quotation_number), newest first.
router.get("/api/quotations", auth(["crm.read"]), (req, res) => {
  const { status } = req.query;
  const rows = db.prepare(`
    SELECT q.* FROM quotations q
    INNER JOIN (SELECT quotation_number, MAX(version) AS max_version FROM quotations GROUP BY quotation_number) latest
      ON latest.quotation_number = q.quotation_number AND latest.max_version = q.version
    ${status ? "WHERE q.status = ?" : ""}
    ORDER BY q.created_at DESC LIMIT 200
  `).all(...(status ? [status] : []));
  res.json(rows.map(serializeQuotation));
});

router.get("/api/quotations/:id", auth(["crm.read"]), (req, res) => {
  const quotation = db.prepare("SELECT * FROM quotations WHERE id = ?").get(req.params.id);
  if (!quotation) return res.status(404).json({ error: "quotation not found" });
  const items = db.prepare("SELECT * FROM quotation_items WHERE quotation_id = ?").all(req.params.id);
  const versions = db.prepare("SELECT id, version, status, created_at FROM quotations WHERE quotation_number = ? ORDER BY version ASC")
    .all(quotation.quotation_number);
  res.json({ ...serializeQuotation(quotation), items: items.map(serializeItem), versions });
});

router.post("/api/quotations", auth(["crm.write"]), (req, res) => {
  const parsed = quotationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  const { itemFils, subtotalFils, totalFils } = computeTotals(d.items, d.discountAed, d.serviceFeeAed);
  const quotationNumber = nextQuotationNumber();

  const result = db.prepare(`
    INSERT INTO quotations (quotation_number, lead_id, customer_id, valid_until, payment_terms, inclusions, exclusions,
      cancellation_terms, subtotal_aed_fils, discount_aed_fils, service_fee_aed_fils, total_aed_fils, owner_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(quotationNumber, d.leadId || null, d.customerId, d.validUntil || null, d.paymentTerms || null,
    d.inclusions || null, d.exclusions || null, d.cancellationTerms || null,
    subtotalFils, toFils(d.discountAed), toFils(d.serviceFeeAed), totalFils, req.user.id);

  const insertItem = db.prepare("INSERT INTO quotation_items (quotation_id, service_type, description, quantity, unit_cost_aed_fils, unit_price_aed_fils, line_total_aed_fils) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const i of itemFils) {
    insertItem.run(result.lastInsertRowid, i.serviceType, i.description, i.quantity, toFils(i.unitCostAed), toFils(i.unitPriceAed), i.lineTotalFils);
  }

  if (d.leadId) {
    db.prepare("UPDATE leads SET status = 'quoted', updated_at = datetime('now') WHERE id = ?").run(d.leadId);
    db.prepare("INSERT INTO lead_activities (lead_id, actor_user_id, channel, body) VALUES (?, ?, 'note', ?)")
      .run(d.leadId, req.user.id, `Quotation ${quotationNumber} prepared`);
  }
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'quotation', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, quotationNumber);

  res.status(201).json({ id: Number(result.lastInsertRowid), quotationNumber, version: 1, status: "draft", totalAed: toAed(totalFils) });
});

// Never overwrites an accepted (or any existing) quotation — creates a new
// row sharing the same quotation_number at version+1, and marks the prior
// version 'superseded'.
router.post("/api/quotations/:id/revise", auth(["crm.write"]), (req, res) => {
  const prior = db.prepare("SELECT * FROM quotations WHERE id = ?").get(req.params.id);
  if (!prior) return res.status(404).json({ error: "quotation not found" });
  if (prior.status === "accepted") return res.status(409).json({ error: "an accepted quotation cannot be revised — it already produced a booking" });

  const priorItems = db.prepare("SELECT * FROM quotation_items WHERE quotation_id = ?").all(prior.id);
  const bodyItems = Array.isArray(req.body.items) ? req.body.items : null;
  const parsedItems = bodyItems ? z.array(itemSchema).min(1).safeParse(bodyItems) : null;
  if (parsedItems && !parsedItems.success) return res.status(400).json({ error: parsedItems.error.issues[0].message });

  const items = parsedItems
    ? parsedItems.data
    : priorItems.map(i => ({ serviceType: i.service_type, description: i.description, quantity: i.quantity, unitCostAed: toAed(i.unit_cost_aed_fils), unitPriceAed: toAed(i.unit_price_aed_fils) }));

  const discountAed = req.body.discountAed !== undefined ? Number(req.body.discountAed) : toAed(prior.discount_aed_fils);
  const serviceFeeAed = req.body.serviceFeeAed !== undefined ? Number(req.body.serviceFeeAed) : toAed(prior.service_fee_aed_fils);
  const { itemFils, subtotalFils, totalFils } = computeTotals(items, discountAed, serviceFeeAed);
  const nextVersion = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM quotations WHERE quotation_number = ?").get(prior.quotation_number).v;

  const result = db.prepare(`
    INSERT INTO quotations (quotation_number, version, lead_id, customer_id, valid_until, payment_terms, inclusions, exclusions,
      cancellation_terms, subtotal_aed_fils, discount_aed_fils, service_fee_aed_fils, total_aed_fils, supersedes_quotation_id, owner_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(prior.quotation_number, nextVersion, prior.lead_id, prior.customer_id,
    req.body.validUntil ?? prior.valid_until, req.body.paymentTerms ?? prior.payment_terms,
    req.body.inclusions ?? prior.inclusions, req.body.exclusions ?? prior.exclusions, req.body.cancellationTerms ?? prior.cancellation_terms,
    subtotalFils, toFils(discountAed), toFils(serviceFeeAed), totalFils, prior.id, req.user.id);

  const insertItem = db.prepare("INSERT INTO quotation_items (quotation_id, service_type, description, quantity, unit_cost_aed_fils, unit_price_aed_fils, line_total_aed_fils) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const i of itemFils) {
    insertItem.run(result.lastInsertRowid, i.serviceType, i.description, i.quantity, toFils(i.unitCostAed), toFils(i.unitPriceAed), i.lineTotalFils);
  }

  db.prepare("UPDATE quotations SET status = 'superseded', updated_at = datetime('now') WHERE id = ?").run(prior.id);
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'revise', 'quotation', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, `${prior.quotation_number} v${nextVersion}`);

  res.status(201).json({ id: Number(result.lastInsertRowid), quotationNumber: prior.quotation_number, version: nextVersion, status: "draft", totalAed: toAed(totalFils) });
});

const statusSchema = z.object({ status: z.enum(["draft", "sent", "rejected", "expired"]) });

router.patch("/api/quotations/:id/status", auth(["crm.write"]), (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const quotation = db.prepare("SELECT id FROM quotations WHERE id = ?").get(req.params.id);
  if (!quotation) return res.status(404).json({ error: "quotation not found" });

  db.prepare("UPDATE quotations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(parsed.data.status, req.params.id);
  res.json({ id: Number(req.params.id), status: parsed.data.status });
});

// Accepted -> booking created directly from the quotation's line items.
// This is the pipeline closure the spec calls for: "Customer Acceptance ->
// Travel Booking" — never a manually re-typed booking.
router.post("/api/quotations/:id/accept", auth(["crm.write"]), (req, res) => {
  const quotation = db.prepare("SELECT * FROM quotations WHERE id = ?").get(req.params.id);
  if (!quotation) return res.status(404).json({ error: "quotation not found" });
  if (quotation.status === "accepted") return res.status(409).json({ error: "quotation already accepted" });
  if (quotation.status === "superseded") return res.status(409).json({ error: "this version was superseded by a later revision — accept the latest version instead" });

  const items = db.prepare("SELECT * FROM quotation_items WHERE quotation_id = ?").all(quotation.id);
  const primaryType = items[0]?.service_type || "holiday";

  const bookingResult = db.prepare(`
    INSERT INTO bookings (customer_id, lead_id, quotation_id, booking_type, description, owner_user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(quotation.customer_id, quotation.lead_id, quotation.id, primaryType, `From quotation ${quotation.quotation_number}`, req.user.id);

  const insertBookingItem = db.prepare("INSERT INTO booking_items (booking_id, description, quantity, unit_price_aed_fils) VALUES (?, ?, ?, ?)");
  for (const i of items) insertBookingItem.run(bookingResult.lastInsertRowid, i.description, i.quantity, i.unit_price_aed_fils);

  db.prepare("UPDATE quotations SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(quotation.id);

  if (quotation.lead_id) {
    db.prepare("UPDATE leads SET status = 'won', updated_at = datetime('now') WHERE id = ?").run(quotation.lead_id);
    db.prepare("INSERT INTO lead_activities (lead_id, actor_user_id, channel, body) VALUES (?, ?, 'note', ?)")
      .run(quotation.lead_id, req.user.id, `Quotation ${quotation.quotation_number} accepted — booking #${bookingResult.lastInsertRowid} created`);
  }
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'accept', 'quotation', ?, ?)")
    .run(req.user.id, quotation.id, `booking #${bookingResult.lastInsertRowid}`);

  res.json({ quotationId: quotation.id, status: "accepted", bookingId: Number(bookingResult.lastInsertRowid) });
});
