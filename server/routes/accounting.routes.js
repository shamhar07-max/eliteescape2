import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { nextInvoiceNumber } from "../lib/invoiceNumber.js";
import { notifyUser } from "../lib/notify.js";
import { toFils, toAed } from "../lib/money.js";

export const router = Router();

const VAT_RATE_BPS = 500; // 5% standard UAE VAT

// DB rows store money as *_aed_fils (integer). API requests/responses use
// *_aed (decimal AED) — these helpers are the only place that boundary is
// crossed, so every route below reads/writes plain AED like before.
const serializeInvoice = (row) => ({
  ...row,
  subtotal_aed: toAed(row.subtotal_aed_fils),
  vat_amount_aed: toAed(row.vat_amount_aed_fils),
  total_aed: toAed(row.total_aed_fils),
});
const serializeInvoiceItem = (row) => ({
  ...row,
  unit_price_aed: toAed(row.unit_price_aed_fils),
  line_total_aed: toAed(row.line_total_aed_fils),
});
const serializePayment = (row) => ({ ...row, amount_aed: toAed(row.amount_aed_fils) });

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitPriceAed: z.number().nonnegative(),
});

const invoiceSchema = z.object({
  bookingId: z.number().int().optional(),
  customerId: z.number().int().optional(),   // required if bookingId not given
  dueDate: z.string().optional(),
  items: z.array(lineItemSchema).optional(), // required if bookingId not given
});

router.get("/api/invoices", auth(["accounting.read"]), (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare("SELECT * FROM invoices WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
    : db.prepare("SELECT * FROM invoices ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows.map(serializeInvoice));
});

router.get("/api/invoices/:id", auth(["accounting.read"]), (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "invoice not found" });
  const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(req.params.id);
  const payments = db.prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at ASC").all(req.params.id);
  const paidTotalFils = payments.reduce((sum, p) => sum + p.amount_aed_fils, 0);

  res.json({
    ...serializeInvoice(invoice),
    items: items.map(serializeInvoiceItem),
    payments: payments.map(serializePayment),
    balanceDueAed: toAed(invoice.total_aed_fils - paidTotalFils),
  });
});

router.post("/api/invoices", auth(["accounting.write"]), (req, res) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  let customerId = d.customerId;
  let items = d.items;

  if (d.bookingId) {
    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(d.bookingId);
    if (!booking) return res.status(404).json({ error: "booking not found" });
    customerId = booking.customer_id;
    const bookingItems = db.prepare("SELECT description, quantity, unit_price_aed_fils FROM booking_items WHERE booking_id = ?").all(d.bookingId);
    if (!bookingItems.length) return res.status(400).json({ error: "booking has no line items to invoice" });
    items = bookingItems.map(i => ({ description: i.description, quantity: i.quantity, unitPriceAed: toAed(i.unit_price_aed_fils) }));
  }

  if (!customerId) return res.status(400).json({ error: "customerId or bookingId required" });
  if (!items || !items.length) return res.status(400).json({ error: "at least one line item required" });

  // All arithmetic below is on integer fils — no floating-point currency math.
  const itemFils = items.map(i => ({ ...i, lineTotalFils: Math.round(i.quantity * toFils(i.unitPriceAed)) }));
  const subtotalFils = itemFils.reduce((sum, i) => sum + i.lineTotalFils, 0);
  const vatAmountFils = Math.round(subtotalFils * VAT_RATE_BPS / 10000);
  const totalFils = subtotalFils + vatAmountFils;
  const invoiceNumber = nextInvoiceNumber();

  const result = db.prepare(
    "INSERT INTO invoices (invoice_number, booking_id, customer_id, due_date, subtotal_aed_fils, vat_rate_bps, vat_amount_aed_fils, total_aed_fils) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(invoiceNumber, d.bookingId || null, customerId, d.dueDate || null, subtotalFils, VAT_RATE_BPS, vatAmountFils, totalFils);

  const insertItem = db.prepare("INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_aed_fils, line_total_aed_fils) VALUES (?, ?, ?, ?, ?)");
  for (const i of itemFils) {
    insertItem.run(result.lastInsertRowid, i.description, i.quantity, toFils(i.unitPriceAed), i.lineTotalFils);
  }

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'invoice', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, invoiceNumber);

  res.status(201).json({
    id: Number(result.lastInsertRowid), invoiceNumber, customerId,
    subtotal: toAed(subtotalFils), vatAmount: toAed(vatAmountFils), total: toAed(totalFils), status: "draft",
  });
});

const statusSchema = z.object({ status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]) });

router.patch("/api/invoices/:id/status", auth(["accounting.write"]), (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const invoice = db.prepare("SELECT id FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "invoice not found" });

  db.prepare("UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(parsed.data.status, req.params.id);
  res.json({ id: Number(req.params.id), status: parsed.data.status });
});

const paymentSchema = z.object({
  amountAed: z.number().positive(),
  method: z.enum(["cash", "card", "bank_transfer", "stripe", "telr"]),
  reference: z.string().optional(),
});

router.post("/api/invoices/:id/payments", auth(["accounting.write"]), async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "invoice not found" });

  const p = parsed.data;
  const amountFils = toFils(p.amountAed);
  const result = db.prepare(
    "INSERT INTO payments (invoice_id, amount_aed_fils, method, reference, recorded_by_user_id) VALUES (?, ?, ?, ?, ?)"
  ).run(req.params.id, amountFils, p.method, p.reference || null, req.user.id);

  const { totalFils } = db.prepare(
    "SELECT COALESCE(SUM(amount_aed_fils), 0) AS totalFils FROM payments WHERE invoice_id = ?"
  ).get(req.params.id);

  let newStatus = invoice.status;
  if (totalFils >= invoice.total_aed_fils && invoice.status !== "paid") {
    newStatus = "paid";
    db.prepare("UPDATE invoices SET status = 'paid', updated_at = datetime('now') WHERE id = ?").run(req.params.id);

    const customer = db.prepare("SELECT full_name FROM customers WHERE id = ?").get(invoice.customer_id);
    await notifyUser(req.user.id, {
      type: "system",
      title: `Invoice ${invoice.invoice_number} fully paid`,
      body: `${customer?.full_name || "Customer"} — AED ${toAed(invoice.total_aed_fils)}`,
      entityType: "invoice",
      entityId: invoice.id,
    });
  }

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'payment', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, `AED ${p.amountAed} via ${p.method}`);

  res.status(201).json({
    id: Number(result.lastInsertRowid), invoiceId: Number(req.params.id), amountAed: p.amountAed, method: p.method,
    reference: p.reference, invoiceStatus: newStatus, paidTotal: toAed(totalFils),
  });
});
