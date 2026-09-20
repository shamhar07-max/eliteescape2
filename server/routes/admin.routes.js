import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { statSync } from "node:fs";
import { db, dbPath } from "../db.js";
import { auth } from "../middleware/auth.js";
import { getRequestMetrics } from "../lib/metrics.js";

export const router = Router();

const ROLE_NAMES = ["owner", "admin", "sales", "ops", "finance", "hr", "marketing"];

// ===== Users =====
router.get("/api/admin/users", auth(["admin.read"]), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, r.name AS role,
      (SELECT MAX(created_at) FROM sessions WHERE user_id = u.id) AS last_login_at,
      (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > datetime('now')) AS active_sessions
    FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name ASC
  `).all();
  res.json(rows);
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: z.enum(ROLE_NAMES),
});

// The only way to create a user once the system is bootstrapped —
// /api/auth/register locks itself after the first (owner) account exists.
router.post("/api/admin/users", auth(["admin.write"]), (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const u = parsed.data;

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(u.email);
  if (existing) return res.status(409).json({ error: "email already registered" });

  const roleRow = db.prepare("SELECT id FROM roles WHERE name = ?").get(u.role);
  const passwordHash = bcrypt.hashSync(u.password, 10);
  const result = db.prepare("INSERT INTO users (email, password_hash, full_name, role_id) VALUES (?, ?, ?, ?)")
    .run(u.email, passwordHash, u.fullName, roleRow.id);

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'create', 'user', ?, ?)")
    .run(req.user.id, result.lastInsertRowid, `${u.email} as ${u.role}`);

  res.status(201).json({ id: Number(result.lastInsertRowid), email: u.email, fullName: u.fullName, role: u.role, isActive: true });
});

const roleSchema = z.object({ role: z.enum(ROLE_NAMES) });

router.patch("/api/admin/users/:id/role", auth(["admin.write"]), (req, res) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid role" });
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "user not found" });

  const roleRow = db.prepare("SELECT id FROM roles WHERE name = ?").get(parsed.data.role);
  db.prepare("UPDATE users SET role_id = ?, updated_at = datetime('now') WHERE id = ?").run(roleRow.id, req.params.id);
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'update_role', 'user', ?, ?)")
    .run(req.user.id, req.params.id, parsed.data.role);

  res.json({ id: Number(req.params.id), role: parsed.data.role });
});

const statusSchema = z.object({ isActive: z.boolean() });

router.patch("/api/admin/users/:id/status", auth(["admin.write"]), (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "isActive must be a boolean" });
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "user not found" });
  if (Number(req.params.id) === req.user.id && !parsed.data.isActive) {
    return res.status(400).json({ error: "cannot deactivate your own account" });
  }

  db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?").run(parsed.data.isActive ? 1 : 0, req.params.id);
  if (!parsed.data.isActive) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(req.params.id);

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, ?, 'user', ?, NULL)")
    .run(req.user.id, parsed.data.isActive ? "activate" : "deactivate", req.params.id);

  res.json({ id: Number(req.params.id), isActive: parsed.data.isActive });
});

router.post("/api/admin/users/:id/revoke-sessions", auth(["admin.write"]), (req, res) => {
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "user not found" });

  const result = db.prepare("DELETE FROM sessions WHERE user_id = ?").run(req.params.id);
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'revoke_sessions', 'user', ?, ?)")
    .run(req.user.id, req.params.id, `${result.changes} session(s)`);

  res.json({ id: Number(req.params.id), revoked: result.changes });
});

// ===== Audit log =====
router.get("/api/admin/audit-log", auth(["admin.read"]), (req, res) => {
  const { entityType } = req.query;
  const rows = entityType
    ? db.prepare(`
        SELECT a.*, u.full_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.entity_type = ? ORDER BY a.created_at DESC LIMIT 200
      `).all(entityType)
    : db.prepare(`
        SELECT a.*, u.full_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC LIMIT 200
      `).all();
  res.json(rows);
});

// ===== System health / monitoring =====
router.get("/api/admin/metrics", auth(["admin.read"]), (req, res) => {
  const count = (sql) => db.prepare(sql).get().n;
  const revenueThisMonthAed = db.prepare(`
    SELECT COALESCE(SUM(total_aed), 0) AS total FROM invoices
    WHERE status = 'paid' AND strftime('%Y-%m', issue_date) = strftime('%Y-%m', 'now')
  `).get().total;

  let dbSizeBytes = null;
  try { dbSizeBytes = statSync(dbPath).size; } catch { /* dev DB not yet created */ }

  res.json({
    activeUsers: count("SELECT COUNT(*) AS n FROM users WHERE is_active = 1"),
    activeSessions: count("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > datetime('now')"),
    customers: count("SELECT COUNT(*) AS n FROM customers"),
    openLeads: count("SELECT COUNT(*) AS n FROM leads WHERE status NOT IN ('won','lost')"),
    bookingsThisMonth: count("SELECT COUNT(*) AS n FROM bookings WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"),
    revenueThisMonthAed,
    activeEmployees: count("SELECT COUNT(*) AS n FROM employees WHERE status != 'terminated'"),
    pendingLeaveRequests: count("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'"),
    pendingPurchaseOrders: count("SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'draft'"),
    unreadNotifications: count("SELECT COUNT(*) AS n FROM notifications WHERE is_read = 0"),
    dbSizeBytes,
    nodeVersion: process.version,
    ...getRequestMetrics(),
  });
});
