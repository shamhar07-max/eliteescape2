import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { notifyRole } from "../lib/notify.js";
import { toFils, toAed } from "../lib/money.js";

export const router = Router();

const serializePayslip = (row) => ({
  ...row,
  basic_salary_aed: toAed(row.basic_salary_aed_fils),
  allowances_aed: toAed(row.allowances_aed_fils),
  deductions_aed: toAed(row.deductions_aed_fils),
  net_pay_aed: toAed(row.net_pay_aed_fils),
});

router.get("/api/payroll-runs", auth(["accounting.read"]), (req, res) => {
  const rows = db.prepare("SELECT * FROM payroll_runs ORDER BY period_year DESC, period_month DESC LIMIT 100").all();
  res.json(rows);
});

router.get("/api/payroll-runs/:id", auth(["accounting.read"]), (req, res) => {
  const run = db.prepare("SELECT * FROM payroll_runs WHERE id = ?").get(req.params.id);
  if (!run) return res.status(404).json({ error: "payroll run not found" });
  const payslips = db.prepare(`
    SELECT p.*, e.full_name AS employee_name, e.job_title FROM payslips p
    JOIN employees e ON e.id = p.employee_id WHERE p.payroll_run_id = ? ORDER BY e.full_name ASC
  `).all(req.params.id);
  const totalNetFils = payslips.reduce((sum, p) => sum + p.net_pay_aed_fils, 0);
  res.json({ ...run, payslips: payslips.map(serializePayslip), totalNetAed: toAed(totalNetFils) });
});

const createRunSchema = z.object({
  periodYear: z.number().int().min(2020).max(2100),
  periodMonth: z.number().int().min(1).max(12),
});

// Creates a draft run and auto-generates one payslip per active employee from
// their current basic salary — allowances/deductions default to 0 and are
// editable per-payslip before the run is processed.
router.post("/api/payroll-runs", auth(["accounting.write"]), (req, res) => {
  const parsed = createRunSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { periodYear, periodMonth } = parsed.data;

  const existing = db.prepare("SELECT id FROM payroll_runs WHERE period_year = ? AND period_month = ?").get(periodYear, periodMonth);
  if (existing) return res.status(409).json({ error: "a payroll run already exists for this period" });

  const employees = db.prepare("SELECT id, basic_salary_aed_fils FROM employees WHERE status != 'terminated'").all();
  if (!employees.length) return res.status(400).json({ error: "no active employees to run payroll for" });

  const runResult = db.prepare("INSERT INTO payroll_runs (period_year, period_month) VALUES (?, ?)").run(periodYear, periodMonth);
  const runId = Number(runResult.lastInsertRowid);

  const insertPayslip = db.prepare(
    "INSERT INTO payslips (payroll_run_id, employee_id, basic_salary_aed_fils, net_pay_aed_fils) VALUES (?, ?, ?, ?)"
  );
  for (const e of employees) insertPayslip.run(runId, e.id, e.basic_salary_aed_fils, e.basic_salary_aed_fils);

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'payroll_run', ?, ?)")
    .run(req.user.id, runId, `${periodYear}-${String(periodMonth).padStart(2, "0")}, ${employees.length} employees`);

  res.status(201).json({ id: runId, periodYear, periodMonth, status: "draft", payslipCount: employees.length });
});

const payslipUpdateSchema = z.object({
  allowancesAed: z.number().nonnegative().optional(),
  deductionsAed: z.number().nonnegative().optional(),
});

router.patch("/api/payslips/:id", auth(["accounting.write"]), (req, res) => {
  const parsed = payslipUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const payslip = db.prepare("SELECT p.*, r.status AS run_status FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id WHERE p.id = ?").get(req.params.id);
  if (!payslip) return res.status(404).json({ error: "payslip not found" });
  if (payslip.run_status !== "draft") return res.status(409).json({ error: "cannot edit a payslip once its run is processed" });

  const allowancesFils = parsed.data.allowancesAed !== undefined ? toFils(parsed.data.allowancesAed) : payslip.allowances_aed_fils;
  const deductionsFils = parsed.data.deductionsAed !== undefined ? toFils(parsed.data.deductionsAed) : payslip.deductions_aed_fils;
  const netPayFils = payslip.basic_salary_aed_fils + allowancesFils - deductionsFils;

  db.prepare("UPDATE payslips SET allowances_aed_fils = ?, deductions_aed_fils = ?, net_pay_aed_fils = ? WHERE id = ?")
    .run(allowancesFils, deductionsFils, netPayFils, req.params.id);

  res.json({ id: Number(req.params.id), allowancesAed: toAed(allowancesFils), deductionsAed: toAed(deductionsFils), netPayAed: toAed(netPayFils) });
});

router.patch("/api/payroll-runs/:id/process", auth(["accounting.write"]), (req, res) => {
  const run = db.prepare("SELECT * FROM payroll_runs WHERE id = ?").get(req.params.id);
  if (!run) return res.status(404).json({ error: "payroll run not found" });
  if (run.status !== "draft") return res.status(409).json({ error: "only a draft run can be processed" });

  db.prepare("UPDATE payroll_runs SET status = 'processed', processed_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ id: Number(req.params.id), status: "processed" });
});

router.patch("/api/payroll-runs/:id/pay", auth(["accounting.write"]), async (req, res) => {
  const run = db.prepare("SELECT * FROM payroll_runs WHERE id = ?").get(req.params.id);
  if (!run) return res.status(404).json({ error: "payroll run not found" });
  if (run.status !== "processed") return res.status(409).json({ error: "only a processed run can be paid" });

  db.prepare("UPDATE payroll_runs SET status = 'paid' WHERE id = ?").run(req.params.id);
  db.prepare("UPDATE payslips SET status = 'paid', paid_at = datetime('now') WHERE payroll_run_id = ?").run(req.params.id);

  const { totalNetFils } = db.prepare("SELECT COALESCE(SUM(net_pay_aed_fils), 0) AS totalNetFils FROM payslips WHERE payroll_run_id = ?").get(req.params.id);
  const totalNetAed = toAed(totalNetFils);
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'pay', 'payroll_run', ?, ?)")
    .run(req.user.id, req.params.id, `AED ${totalNetAed} disbursed`);

  await notifyRole(["owner", "admin"], {
    type: "system",
    title: `Payroll paid: ${run.period_year}-${String(run.period_month).padStart(2, "0")}`,
    body: `AED ${totalNetAed} disbursed`,
    entityType: "payroll_run",
    entityId: Number(req.params.id),
  });

  res.json({ id: Number(req.params.id), status: "paid", totalNetAed });
});
