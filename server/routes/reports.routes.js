import { Router } from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { toAed } from "../lib/money.js";
import { accountBalanceFils, ACCOUNTS } from "../lib/gl.js";

export const router = Router();

// Six full calendar months including the current one, oldest first — the
// shared x-axis for every "trend" series below.
const last6Months = () => db.prepare(`
  WITH RECURSIVE months(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM months WHERE n < 5)
  SELECT strftime('%Y-%m', date('now', 'start of month', '-' || n || ' months')) AS month FROM months ORDER BY month ASC
`).all().map(r => r.month);

// ===== Owner Command Center (section 30) =====
router.get("/api/reports/overview", auth(["admin.read"]), (req, res) => {
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;

  const accountsReceivableAed = toAed(accountBalanceFils(db.prepare("SELECT id FROM chart_of_accounts WHERE code = ?").get(ACCOUNTS.ACCOUNTS_RECEIVABLE).id));
  const accountsPayableAed = toAed(accountBalanceFils(db.prepare("SELECT id FROM chart_of_accounts WHERE code = ?").get(ACCOUNTS.ACCOUNTS_PAYABLE).id));
  const cashCollectedTodayFils = db.prepare("SELECT COALESCE(SUM(amount_aed_fils), 0) AS total FROM payments WHERE date(paid_at) = date('now')").get().total;

  res.json({
    newInquiriesToday: count("SELECT COUNT(*) AS n FROM leads WHERE date(created_at) = date('now')"),
    unassignedLeads: count("SELECT COUNT(*) AS n FROM leads WHERE owner_user_id IS NULL AND status NOT IN ('won', 'lost')"),
    hotOpportunities: count("SELECT COUNT(*) AS n FROM leads WHERE status IN ('quoted', 'contacted') AND updated_at >= datetime('now', '-3 days')"),
    quotesSent: count("SELECT COUNT(*) AS n FROM quotations WHERE status = 'sent'"),
    confirmedBookings: count("SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed'"),
    upcomingDepartures: count("SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND travel_date_start BETWEEN date('now') AND date('now', '+14 days')"),
    activeVisaCases: count("SELECT COUNT(*) AS n FROM visa_cases WHERE status NOT IN ('completed', 'rejected', 'withdrawn', 'cancelled')"),
    pendingSupplierConfirmations: count("SELECT COUNT(*) AS n FROM booking_items WHERE service_status = 'requested'"),
    accountsReceivableAed,
    accountsPayableAed,
    cashCollectedTodayAed: toAed(cashCollectedTodayFils),
    pendingApprovals: count("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'")
      + count("SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'draft'")
      + count("SELECT COUNT(*) AS n FROM refunds WHERE status = 'draft'"),
    marketingLeadsThisMonth: count("SELECT COUNT(*) AS n FROM leads WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"),
    eliteReachLeadsThisMonth: count(`
      SELECT COUNT(*) AS n FROM leads l JOIN customers c ON c.id = l.customer_id
      WHERE c.source = 'elite_reach' AND strftime('%Y-%m', l.created_at) = strftime('%Y-%m', 'now')
    `),
  });
});

// ===== Sales / lead conversion / consultant performance =====
router.get("/api/reports/sales", auth(["crm.read"]), (req, res) => {
  const byStatus = db.prepare("SELECT status, COUNT(*) AS n FROM leads GROUP BY status").all();
  const bySource = db.prepare(`
    SELECT COALESCE(c.source, 'unknown') AS source, COUNT(*) AS n FROM leads l LEFT JOIN customers c ON c.id = l.customer_id GROUP BY source
  `).all();
  const byInterestType = db.prepare("SELECT interest_type, COUNT(*) AS n FROM leads GROUP BY interest_type ORDER BY n DESC").all();

  const totalLeads = byStatus.reduce((s, r) => s + r.n, 0);
  const wonLeads = byStatus.find(r => r.status === "won")?.n || 0;
  const conversionRate = totalLeads ? Math.round((wonLeads / totalLeads) * 1000) / 10 : 0;

  const months = last6Months();
  const monthlyTrend = months.map(month => ({
    month,
    newLeads: db.prepare("SELECT COUNT(*) AS n FROM leads WHERE strftime('%Y-%m', created_at) = ?").get(month).n,
    won: db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'won' AND strftime('%Y-%m', updated_at) = ?").get(month).n,
  }));

  const consultantPerformance = db.prepare(`
    SELECT u.id AS userId, u.full_name AS userName, COUNT(*) AS leadsOwned,
      SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) AS leadsWon
    FROM leads l JOIN users u ON u.id = l.owner_user_id
    GROUP BY u.id ORDER BY leadsWon DESC
  `).all();

  res.json({ byStatus, bySource, byInterestType, totalLeads, wonLeads, conversionRatePct: conversionRate, monthlyTrend, consultantPerformance });
});

// ===== Bookings / destination performance =====
router.get("/api/reports/bookings", auth(["ops.read"]), (req, res) => {
  const byType = db.prepare("SELECT booking_type, COUNT(*) AS n FROM bookings GROUP BY booking_type ORDER BY n DESC").all();
  const byStatus = db.prepare("SELECT status, COUNT(*) AS n FROM bookings GROUP BY status").all();

  const months = last6Months();
  const monthlyTrend = months.map(month => ({
    month, bookings: db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE strftime('%Y-%m', created_at) = ?").get(month).n,
  }));

  // "Destination performance" (section 63) grounded in the one structured
  // destination field the schema actually has — flight items' destination —
  // rather than parsing free-text booking descriptions.
  const topDestinations = db.prepare(`
    SELECT bid.destination, COUNT(*) AS flightCount, COALESCE(SUM(bi.quantity * bi.unit_price_aed_fils), 0) AS revenueFils
    FROM booking_item_details bid
    JOIN booking_items bi ON bi.id = bid.booking_item_id
    WHERE bid.destination IS NOT NULL AND bid.destination != ''
    GROUP BY bid.destination ORDER BY flightCount DESC LIMIT 10
  `).all().map(r => ({ destination: r.destination, flightCount: r.flightCount, revenueAed: toAed(r.revenueFils) }));

  const upcomingDepartures = db.prepare(`
    SELECT id, description, travel_date_start FROM bookings
    WHERE status = 'confirmed' AND travel_date_start BETWEEN date('now') AND date('now', '+14 days')
    ORDER BY travel_date_start ASC
  `).all();

  res.json({ byType, byStatus, monthlyTrend, topDestinations, upcomingDepartures });
});

// ===== Visa case reporting =====
router.get("/api/reports/visa", auth(["ops.read"]), (req, res) => {
  const byStatus = db.prepare("SELECT status, COUNT(*) AS n FROM visa_cases GROUP BY status").all();
  const byCountry = db.prepare("SELECT destination_country, COUNT(*) AS n FROM visa_cases GROUP BY destination_country ORDER BY n DESC LIMIT 10").all();

  const avgDaysToComplete = db.prepare(`
    SELECT AVG(julianday(completed.created_at) - julianday(vc.created_at)) AS avgDays
    FROM visa_cases vc
    JOIN (SELECT visa_case_id, MIN(created_at) AS created_at FROM visa_case_status_history WHERE status = 'completed' GROUP BY visa_case_id) completed
      ON completed.visa_case_id = vc.id
  `).get().avgDays;

  res.json({ byStatus, byCountry, avgDaysToComplete: avgDaysToComplete ? Math.round(avgDaysToComplete * 10) / 10 : null });
});

// ===== Finance: receivables/payables/cash/profitability/refunds =====
router.get("/api/reports/finance", auth(["accounting.read"]), (req, res) => {
  const arAccount = db.prepare("SELECT id FROM chart_of_accounts WHERE code = ?").get(ACCOUNTS.ACCOUNTS_RECEIVABLE);
  const apAccount = db.prepare("SELECT id FROM chart_of_accounts WHERE code = ?").get(ACCOUNTS.ACCOUNTS_PAYABLE);
  const receivablesAed = toAed(accountBalanceFils(arAccount.id));
  const payablesAed = toAed(accountBalanceFils(apAccount.id));

  const months = last6Months();
  const monthlyTrend = months.map(month => ({
    month,
    revenueAed: toAed(db.prepare("SELECT COALESCE(SUM(subtotal_aed_fils), 0) AS total FROM invoices WHERE status != 'draft' AND strftime('%Y-%m', issue_date) = ?").get(month).total),
    cashCollectedAed: toAed(db.prepare("SELECT COALESCE(SUM(amount_aed_fils), 0) AS total FROM payments WHERE strftime('%Y-%m', paid_at) = ?").get(month).total),
  }));

  const profitability = db.prepare(`
    SELECT COALESCE(SUM(bi.quantity * bi.unit_price_aed_fils), 0) AS sellFils, COALESCE(SUM(bi.quantity * bi.supplier_cost_aed_fils), 0) AS costFils
    FROM booking_items bi
  `).get();
  const refundsTotal = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_aed_fils), 0) AS totalFils FROM refunds WHERE status = 'paid'").get();
  const refundsByType = db.prepare("SELECT refund_type, COUNT(*) AS n, COALESCE(SUM(amount_aed_fils), 0) AS totalFils FROM refunds WHERE status = 'paid' GROUP BY refund_type").all()
    .map(r => ({ refundType: r.refund_type, count: r.n, totalAed: toAed(r.totalFils) }));
  const cancelledBookings = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'cancelled'").get().n;

  const repeatCustomers = db.prepare(`
    SELECT COUNT(*) AS n FROM (SELECT customer_id FROM bookings GROUP BY customer_id HAVING COUNT(*) > 1)
  `).get().n;
  const customersWithBookings = db.prepare("SELECT COUNT(DISTINCT customer_id) AS n FROM bookings").get().n;
  const repeatRatePct = customersWithBookings ? Math.round((repeatCustomers / customersWithBookings) * 1000) / 10 : 0;

  res.json({
    receivablesAed, payablesAed, monthlyTrend,
    profitability: { totalSellAed: toAed(profitability.sellFils), totalCostAed: toAed(profitability.costFils), grossProfitAed: toAed(profitability.sellFils - profitability.costFils) },
    refunds: { count: refundsTotal.n, totalAed: toAed(refundsTotal.totalFils), byType: refundsByType },
    cancelledBookings,
    customerRepeatRate: { repeatCustomers, customersWithBookings, repeatRatePct },
  });
});

// ===== Supplier performance across the whole book =====
router.get("/api/reports/suppliers", auth(["procurement.read"]), (req, res) => {
  const topSuppliers = db.prepare(`
    SELECT v.id, v.name, v.category, COUNT(po.id) AS poCount, COALESCE(SUM(po.amount_aed_fils), 0) AS totalSpentFils
    FROM vendors v LEFT JOIN purchase_orders po ON po.vendor_id = v.id
    GROUP BY v.id HAVING poCount > 0 ORDER BY totalSpentFils DESC LIMIT 10
  `).all().map(r => ({ id: r.id, name: r.name, category: r.category, poCount: r.poCount, totalSpentAed: toAed(r.totalSpentFils) }));

  const poByStatus = db.prepare("SELECT status, COUNT(*) AS n FROM purchase_orders GROUP BY status").all();

  res.json({ topSuppliers, poByStatus });
});

// ===== Marketing / Elite Reach attribution =====
router.get("/api/reports/marketing", auth(["marketing.read"]), (req, res) => {
  const campaigns = db.prepare("SELECT id, name, channel, status, sent_count FROM campaigns ORDER BY created_at DESC LIMIT 20").all();
  const leadsBySource = db.prepare(`
    SELECT COALESCE(c.source, 'unknown') AS source, COUNT(*) AS n FROM leads l LEFT JOIN customers c ON c.id = l.customer_id GROUP BY source ORDER BY n DESC
  `).all();
  const eliteReachLeads = leadsBySource.find(r => r.source === "elite_reach")?.n || 0;
  const latestSeoAudit = db.prepare("SELECT base_url, issues_found, run_at FROM seo_audits ORDER BY run_at DESC LIMIT 1").get() || null;

  res.json({ campaigns, leadsBySource, eliteReachLeads, latestSeoAudit });
});
