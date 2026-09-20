import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { nextInvoiceNumber } from "../lib/invoiceNumber.js";
import { notifyUser } from "../lib/notify.js";

export const router = Router();

const VAT_RATE_BPS = 500; // 5% standard UAE VAT

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
  res.json(rows);
});

router.get("/api/invoices/:id", auth(["accounting.read"]), (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "invoice not found" });
  const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(req.params.id);
  const payments = db.prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at ASC").all(req.params.id);
  const paidTotal = payments.reduce((sum, p) => sum + p.amount_aed, 0);
  res.json({ ...invoice, items, payments, balanceDueAed: Math.round((invoice.total_aed - paidTotal) * 100) / 100 });
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
    const bookingItems = db.prepare("SELECT description, quantity, unit_price_aed FROM booking_items WHERE booking_id = ?").all(d.bookingId);
    if (!bookingItems.length) return res.status(400).json({ error: "booking has no line items to invoice" });
    items = bookingItems.map(i => ({ description: i.description, quantity: i.quantity, unitPriceAed: i.unit_price_aed }));
  }

  if (!customerId) return res.status(400).json({ error: "customerId or bookingId required" });
  if (!items || !items.length) return res.status(400).json({ error: "at least one line item required" });

  const subtotal = Math.round(items.reduce((sum, i) => sum + i.quantity * i.unitPriceAed, 0) * 100) / 100;
  const vatAmount = Math.round(subtotal * (VAT_RATE_BPS / 10000) * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;
  const invoiceNumber = nextInvoiceNumber();

  const result = db.prepare(
    "INSERT INTO invoices (invoice_number, booking_id, customer_id, due_date, subtotal_aed, vat_rate_bps, vat_amount_aed, total_aed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(invoiceNumber, d.bookingId || null, customerId, d.dueDate || null, subtotal, VAT_RATE_BPS, vatAmount, total);

  const insertItem = db.prepare("INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_aed, line_total_aed) VALUES (?, ?, ?, ?, ?)");
  for (const i of items) {
    insertItem.run(result.lastInsertRowid, i.description, i.quantity, i.unitPriceAed, Math.round(i.quantity * i.unitPriceAed * 100) / 100);
  }

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'invoice', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, invoiceNumber);

  res.status(201).json({ id: Number(result.lastInsertRowid), invoiceNumber, customerId, subtotal, vatAmount, total, status: "draft" });
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
  const result = db.prepare(
    "INSERT INTO payments (invoice_id, amount_aed, method, reference, recorded_by_user_id) VALUES (?, ?, ?, ?, ?)"
  ).run(req.params.id, p.amountAed, p.method, p.reference || null, req.user.id);

  const { total } = db.prepare(
    "SELECT COALESCE(SUM(amount_aed), 0) AS total FROM payments WHERE invoice_id = ?"
  ).get(req.params.id);

  let newStatus = invoice.status;
  if (total >= invoice.total_aed && invoice.status !== "paid") {
    newStatus = "paid";
    db.prepare("UPDATE invoices SET status = 'paid', updated_at = datetime('now') WHERE id = ?").run(req.params.id);

    const customer = db.prepare("SELECT full_name FROM customers WHERE id = ?").get(invoice.customer_id);
    await notifyUser(req.user.id, {
      type: "system",
      title: `Invoice ${invoice.invoice_number} fully paid`,
      body: `${customer?.full_name || "Customer"} — AED ${invoice.total_aed}`,
      entityType: "invoice",
      entityId: invoice.id,
    });
  }

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'payment', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, `AED ${p.amountAed} via ${p.method}`);

  res.status(201).json({ id: Number(result.lastInsertRowid), invoiceId: Number(req.params.id), ...p, invoiceStatus: newStatus, paidTotal: total });
});
