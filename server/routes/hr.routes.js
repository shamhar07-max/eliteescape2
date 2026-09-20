import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { notifyRole } from "../lib/notify.js";

export const router = Router();

const employeeSchema = z.object({
  userId: z.number().int().optional(),
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  jobTitle: z.string().min(1),
  department: z.enum(["sales", "ops", "finance", "hr", "admin", "management"]),
  employmentType: z.enum(["full_time", "part_time", "contract"]).default("full_time"),
  basicSalaryAed: z.number().nonnegative().default(0),
  joinDate: z.string().min(1),
});

router.get("/api/employees", auth(["hr.read"]), (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare("SELECT * FROM employees WHERE status = ? ORDER BY full_name ASC").all(status)
    : db.prepare("SELECT * FROM employees ORDER BY full_name ASC").all();
  res.json(rows);
});

router.get("/api/employees/:id", auth(["hr.read"]), (req, res) => {
  const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(req.params.id);
  if (!employee) return res.status(404).json({ error: "employee not found" });
  const leaveRequests = db.prepare("SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20").all(req.params.id);
  res.json({ ...employee, leaveRequests });
});

router.post("/api/employees", auth(["hr.write"]), (req, res) => {
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const e = parsed.data;

  const result = db.prepare(
    "INSERT INTO employees (user_id, full_name, email, phone, job_title, department, employment_type, basic_salary_aed, join_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(e.userId || null, e.fullName, e.email || null, e.phone || null, e.jobTitle, e.department, e.employmentType, e.basicSalaryAed, e.joinDate);

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'employee', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, e.fullName);

  res.status(201).json({ id: Number(result.lastInsertRowid), ...e, status: "active" });
});

const employeeUpdateSchema = z.object({
  jobTitle: z.string().min(1).optional(),
  department: z.enum(["sales", "ops", "finance", "hr", "admin", "management"]).optional(),
  employmentType: z.enum(["full_time", "part_time", "contract"]).optional(),
  basicSalaryAed: z.number().nonnegative().optional(),
});

router.patch("/api/employees/:id", auth(["hr.write"]), (req, res) => {
  const parsed = employeeUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const employee = db.prepare("SELECT id FROM employees WHERE id = ?").get(req.params.id);
  if (!employee) return res.status(404).json({ error: "employee not found" });

  const fields = { job_title: "jobTitle", department: "department", employment_type: "employmentType", basic_salary_aed: "basicSalaryAed" };
  const sets = [], values = [];
  for (const [col, key] of Object.entries(fields)) {
    if (parsed.data[key] !== undefined) { sets.push(`${col} = ?`); values.push(parsed.data[key]); }
  }
  if (!sets.length) return res.status(400).json({ error: "no fields to update" });

  db.prepare(`UPDATE employees SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...values, req.params.id);
  res.json(db.prepare("SELECT * FROM employees WHERE id = ?").get(req.params.id));
});

const employeeStatusSchema = z.object({ status: z.enum(["active", "on_leave", "terminated"]) });

router.patch("/api/employees/:id/status", auth(["hr.write"]), (req, res) => {
  const parsed = employeeStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const employee = db.prepare("SELECT id FROM employees WHERE id = ?").get(req.params.id);
  if (!employee) return res.status(404).json({ error: "employee not found" });

  db.prepare("UPDATE employees SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(parsed.data.status, req.params.id);
  res.json({ id: Number(req.params.id), status: parsed.data.status });
});

// ===== Leave requests =====
const leaveRequestSchema = z.object({
  employeeId: z.number().int(),
  leaveType: z.enum(["annual", "sick", "unpaid", "emergency"]),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().optional(),
});

router.get("/api/leave-requests", auth(["hr.read"]), (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare(`
        SELECT lr.*, e.full_name AS employee_name FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id WHERE lr.status = ? ORDER BY lr.created_at DESC LIMIT 200
      `).all(status)
    : db.prepare(`
        SELECT lr.*, e.full_name AS employee_name FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id ORDER BY lr.created_at DESC LIMIT 200
      `).all();
  res.json(rows);
});

router.post("/api/leave-requests", auth(["hr.write"]), async (req, res) => {
  const parsed = leaveRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const l = parsed.data;

  const employee = db.prepare("SELECT full_name FROM employees WHERE id = ?").get(l.employeeId);
  if (!employee) return res.status(404).json({ error: "employee not found" });

  const result = db.prepare(
    "INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)"
  ).run(l.employeeId, l.leaveType, l.startDate, l.endDate, l.reason || null);

  await notifyRole(["owner", "admin", "hr"], {
    type: "system",
    title: `Leave request: ${employee.full_name}`,
    body: `${l.leaveType} — ${l.startDate} to ${l.endDate}`,
    entityType: "leave_request",
    entityId: Number(result.lastInsertRowid),
  });

  res.status(201).json({ id: Number(result.lastInsertRowid), ...l, status: "pending" });
});

const leaveDecisionSchema = z.object({ status: z.enum(["approved", "rejected"]) });

router.patch("/api/leave-requests/:id/decision", auth(["hr.write"]), (req, res) => {
  const parsed = leaveDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
  const leave = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(req.params.id);
  if (!leave) return res.status(404).json({ error: "leave request not found" });

  db.prepare("UPDATE leave_requests SET status = ?, decided_by_user_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(parsed.data.status, req.user.id, req.params.id);

  if (parsed.data.status === "approved") {
    db.prepare("UPDATE employees SET status = 'on_leave', updated_at = datetime('now') WHERE id = ?").run(leave.employee_id);
  }

  res.json({ id: Number(req.params.id), status: parsed.data.status });
});
