import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { nextSequence } from "../lib/sequence.js";
import { toFils, toAed } from "../lib/money.js";
import { postJournalEntry, ACCOUNTS } from "../lib/gl.js";

export const router = Router();

const serializeRefund = (row) => ({ ...row, amount_aed: toAed(row.amount_aed_fils) });

const refundSchema = z.object({
  refundType: z.enum(["customer", "supplier"]),
  bookingId: z.number().int().optional(),
  invoiceId: z.number().int().optional(),
  purchaseOrderId: z.number().int().optional(),
  amountAed: z.number().positive(),
  reason: z.string().min(1),
});

router.get("/api/refunds", auth(["accounting.read"]), (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare("SELECT * FROM refunds WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
    : db.prepare("SELECT * FROM refunds ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows.map(serializeRefund));
});

router.post("/api/refunds", auth(["accounting.write"]), (req, res) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const r = parsed.data;

  if (r.refundType === "customer" && !r.invoiceId && !r.bookingId) {
    return res.status(400).json({ error: "a customer refund needs an invoiceId or bookingId" });
  }
  if (r.refundType === "supplier" && !r.purchaseOrderId) {
    return res.status(400).json({ error: "a supplier refund needs a purchaseOrderId" });
  }

  const refundNumber = nextSequence("refund", "REF");
  const result = db.prepare(`
    INSERT INTO refunds (refund_number, refund_type, booking_id, invoice_id, purchase_order_id, amount_aed_fils, reason, requested_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(refundNumber, r.refundType, r.bookingId || null, r.invoiceId || null, r.purchaseOrderId || null, toFils(r.amountAed), r.reason, req.user.id);

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'refund', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, `${refundNumber} — AED ${r.amountAed} (${r.refundType})`);

  res.status(201).json({ id: Number(result.lastInsertRowid), refundNumber, ...r, status: "draft" });
});

const refundStatusSchema = z.object({ status: z.enum(["draft", "approved", "paid", "cancelled"]) });

router.patch("/api/refunds/:id/status", auth(["accounting.write"]), (req, res) => {
  const parsed = refundStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const refund = db.prepare("SELECT * FROM refunds WHERE id = ?").get(req.params.id);
  if (!refund) return res.status(404).json({ error: "refund not found" });
  if (parsed.data.status === "approved" && refund.status !== "draft") {
    return res.status(409).json({ error: "only a draft refund can be approved" });
  }
  if (parsed.data.status === "paid" && refund.status !== "approved") {
    return res.status(409).json({ error: "only an approved refund can be paid" });
  }

  db.prepare("UPDATE refunds SET status = ?, updated_at = datetime('now') WHERE id = ?").run(parsed.data.status, req.params.id);

  // Customer refund: money leaves the business (contra-revenue expense) —
  // Dr Customer Refunds, Cr Bank. Supplier refund: a credit note received
  // back from a supplier reduces what was booked as cost — Dr Bank, Cr
  // Supplier Cost of Services.
  if (parsed.data.status === "paid") {
    postJournalEntry({
      memo: `${refund.refund_number} — ${refund.reason}`,
      sourceType: "refund",
      sourceId: refund.id,
      userId: req.user.id,
      lines: refund.refund_type === "customer"
        ? [
            { accountCode: ACCOUNTS.CUSTOMER_REFUNDS, debitFils: refund.amount_aed_fils, description: refund.refund_number },
            { accountCode: ACCOUNTS.BANK, creditFils: refund.amount_aed_fils, description: refund.refund_number },
          ]
        : [
            { accountCode: ACCOUNTS.BANK, debitFils: refund.amount_aed_fils, description: refund.refund_number },
            { accountCode: ACCOUNTS.SUPPLIER_COST, creditFils: refund.amount_aed_fils, description: refund.refund_number },
          ],
    });
  }

  res.json({ id: Number(req.params.id), status: parsed.data.status });
});
