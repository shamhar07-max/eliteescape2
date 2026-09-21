import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { nextInvoiceNumber } from "../lib/invoiceNumber.js";
import { notifyUser } from "../lib/notify.js";
import { toFils, toAed } from "../lib/money.js";
import { postJournalEntry, accountBalanceFils, ACCOUNTS } from "../lib/gl.js";

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

  // A sent invoice is a real receivable — post it to the GL exactly once
  // (postJournalEntry is idempotent on source_type+source_id, so re-sending
  // an already-sent invoice never double-posts).
  if (parsed.data.status === "sent") {
    const full = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    postJournalEntry({
      entryDate: full.issue_date,
      memo: `Invoice ${full.invoice_number} sent`,
      sourceType: "invoice_sent",
      sourceId: full.id,
      userId: req.user.id,
      lines: [
        { accountCode: ACCOUNTS.ACCOUNTS_RECEIVABLE, debitFils: full.total_aed_fils, description: full.invoice_number },
        { accountCode: ACCOUNTS.REVENUE, creditFils: full.subtotal_aed_fils, description: full.invoice_number },
        { accountCode: ACCOUNTS.VAT_OUTPUT, creditFils: full.vat_amount_aed_fils, description: full.invoice_number },
      ],
    });
  }

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

  postJournalEntry({
    memo: `Payment received for ${invoice.invoice_number} via ${p.method}`,
    sourceType: "payment",
    sourceId: Number(result.lastInsertRowid),
    userId: req.user.id,
    lines: [
      { accountCode: p.method === "cash" ? ACCOUNTS.CASH : ACCOUNTS.BANK, debitFils: amountFils, description: invoice.invoice_number },
      { accountCode: ACCOUNTS.ACCOUNTS_RECEIVABLE, creditFils: amountFils, description: invoice.invoice_number },
    ],
  });

  res.status(201).json({
    id: Number(result.lastInsertRowid), invoiceId: Number(req.params.id), amountAed: p.amountAed, method: p.method,
    reference: p.reference, invoiceStatus: newStatus, paidTotal: toAed(totalFils),
  });
});

// ===== General ledger =====
router.get("/api/gl/accounts", auth(["accounting.read"]), (req, res) => {
  const accounts = db.prepare("SELECT * FROM chart_of_accounts ORDER BY code ASC").all();
  res.json(accounts.map(a => ({ ...a, balanceAed: toAed(accountBalanceFils(a.id, req.query.asOf || null)) })));
});

router.get("/api/gl/journal-entries", auth(["accounting.read"]), (req, res) => {
  const entries = db.prepare("SELECT * FROM journal_entries ORDER BY entry_date DESC, id DESC LIMIT 200").all();
  res.json(entries);
});

router.get("/api/gl/journal-entries/:id", auth(["accounting.read"]), (req, res) => {
  const entry = db.prepare("SELECT * FROM journal_entries WHERE id = ?").get(req.params.id);
  if (!entry) return res.status(404).json({ error: "journal entry not found" });
  const lines = db.prepare(`
    SELECT jl.*, coa.code, coa.name AS account_name FROM journal_lines jl
    JOIN chart_of_accounts coa ON coa.id = jl.account_id WHERE jl.journal_entry_id = ?
  `).all(req.params.id);
  res.json({
    ...entry,
    lines: lines.map(l => ({ ...l, debitAed: toAed(l.debit_aed_fils), creditAed: toAed(l.credit_aed_fils) })),
  });
});

// A trial balance: every account's balance as of a date (or all time),
// signed by its own normal side — must always sum to zero if the ledger is
// sound, since every posted entry balances by construction.
router.get("/api/gl/trial-balance", auth(["accounting.read"]), (req, res) => {
  const asOf = req.query.asOf || null;
  const accounts = db.prepare("SELECT * FROM chart_of_accounts WHERE is_active = 1 ORDER BY code ASC").all();
  const rows = accounts.map(a => ({
    code: a.code, name: a.name, type: a.type,
    balanceAed: toAed(accountBalanceFils(a.id, asOf)),
  }));
  // Every account reports its balance signed to its own normal side, so a
  // sound ledger's debit-normal balances always net to zero against its
  // credit-normal ones.
  const netAed = rows.reduce((sum, r) => sum + (["asset", "expense"].includes(r.type) ? r.balanceAed : -r.balanceAed), 0);
  res.json({ asOf: asOf || "all time", accounts: rows, balanced: Math.abs(netAed) < 0.01 });
});

// Profit & loss for a period: revenue accounts minus expense accounts.
router.get("/api/gl/profit-and-loss", auth(["accounting.read"]), (req, res) => {
  const { from, to } = req.query;
  const revAccounts = db.prepare("SELECT * FROM chart_of_accounts WHERE type = 'revenue'").all();
  const expAccounts = db.prepare("SELECT * FROM chart_of_accounts WHERE type = 'expense'").all();
  const balanceInRange = (accountId) => {
    const row = db.prepare(`
      SELECT COALESCE(SUM(jl.debit_aed_fils), 0) AS debit, COALESCE(SUM(jl.credit_aed_fils), 0) AS credit
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = ? AND je.status = 'posted'
        ${from ? "AND je.entry_date >= ?" : ""} ${to ? "AND je.entry_date <= ?" : ""}
    `).get(accountId, ...[from, to].filter(Boolean));
    return row;
  };
  const revenue = revAccounts.map(a => { const r = balanceInRange(a.id); return { code: a.code, name: a.name, amountAed: toAed(r.credit - r.debit) }; });
  const expenses = expAccounts.map(a => { const r = balanceInRange(a.id); return { code: a.code, name: a.name, amountAed: toAed(r.debit - r.credit) }; });
  const totalRevenueAed = revenue.reduce((s, r) => s + r.amountAed, 0);
  const totalExpensesAed = expenses.reduce((s, r) => s + r.amountAed, 0);
  res.json({ from: from || null, to: to || null, revenue, expenses, totalRevenueAed, totalExpensesAed, netProfitAed: totalRevenueAed - totalExpensesAed });
});

// Balance sheet as of a date: assets vs liabilities + equity (including
// current-period retained earnings, since P&L accounts don't close nightly).
router.get("/api/gl/balance-sheet", auth(["accounting.read"]), (req, res) => {
  const asOf = req.query.asOf || null;
  const byType = (type) => db.prepare("SELECT * FROM chart_of_accounts WHERE type = ?").all(type)
    .map(a => ({ code: a.code, name: a.name, balanceAed: toAed(accountBalanceFils(a.id, asOf)) }));
  const assets = byType("asset");
  const liabilities = byType("liability");
  const equity = byType("equity");
  const revAccounts = db.prepare("SELECT id FROM chart_of_accounts WHERE type = 'revenue'").all();
  const expAccounts = db.prepare("SELECT id FROM chart_of_accounts WHERE type = 'expense'").all();
  const totalRevenueFils = revAccounts.reduce((s, a) => s + accountBalanceFils(a.id, asOf), 0);
  const totalExpenseFils = expAccounts.reduce((s, a) => s + accountBalanceFils(a.id, asOf), 0);
  const currentEarningsAed = toAed(totalRevenueFils - totalExpenseFils);
  const totalAssetsAed = assets.reduce((s, a) => s + a.balanceAed, 0);
  const totalLiabilitiesAed = liabilities.reduce((s, a) => s + a.balanceAed, 0);
  const totalEquityAed = equity.reduce((s, a) => s + a.balanceAed, 0) + currentEarningsAed;
  res.json({
    asOf: asOf || "all time", assets, liabilities, equity,
    currentPeriodEarningsAed: currentEarningsAed,
    totalAssetsAed, totalLiabilitiesAed, totalEquityAed,
    balanced: Math.abs(totalAssetsAed - (totalLiabilitiesAed + totalEquityAed)) < 0.01,
  });
});

// Per-booking profitability: sell price vs supplier cost across its typed
// line items — the master spec's "Provisional Revenue − Provisional Cost".
router.get("/api/bookings/:id/profitability", auth(["accounting.read"]), (req, res) => {
  const booking = db.prepare("SELECT id, description FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "booking not found" });
  const items = db.prepare("SELECT service_type, description, quantity, unit_price_aed_fils, supplier_cost_aed_fils FROM booking_items WHERE booking_id = ?").all(req.params.id);
  const lines = items.map(i => ({
    serviceType: i.service_type, description: i.description,
    sellAed: toAed(Math.round(i.quantity * i.unit_price_aed_fils)),
    costAed: toAed(Math.round(i.quantity * i.supplier_cost_aed_fils)),
  }));
  const totalSellAed = lines.reduce((s, l) => s + l.sellAed, 0);
  const totalCostAed = lines.reduce((s, l) => s + l.costAed, 0);
  const refunds = db.prepare("SELECT COALESCE(SUM(amount_aed_fils), 0) AS totalFils FROM refunds WHERE booking_id = ? AND status = 'paid'").get(req.params.id);
  const refundsAed = toAed(refunds.totalFils);
  res.json({
    bookingId: booking.id, items: lines, totalSellAed, totalCostAed,
    provisionalProfitAed: totalSellAed - totalCostAed,
    refundsAed, finalProfitAed: totalSellAed - totalCostAed - refundsAed,
  });
});
