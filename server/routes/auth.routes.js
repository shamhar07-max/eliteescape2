import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db.js";
import { genToken, sessionExpiry } from "../lib/crypto.js";
import { auth } from "../middleware/auth.js";
import { rateLimit } from "../lib/rateLimit.js";

export const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
});

// Self-registration only ever creates the FIRST user (system bootstrap), and
// that user is always 'owner' — anyone could previously register as any
// role, including 'owner', at any time. Once a user exists, every other
// account must be created by an admin via POST /api/admin/users.
router.post("/api/auth/register", (req, res) => {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount > 0) {
    return res.status(403).json({ error: "self-registration is disabled — ask an admin to create your account" });
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { email, password, fullName } = parsed.data;

  const roleRow = db.prepare("SELECT id FROM roles WHERE name = 'owner'").get();
  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    "INSERT INTO users (email, password_hash, full_name, role_id) VALUES (?, ?, ?, ?)"
  ).run(email, passwordHash, fullName, roleRow.id);

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'register', 'user', ?, 'bootstrap owner')")
    .run(result.lastInsertRowid, result.lastInsertRowid);

  res.status(201).json({ id: Number(result.lastInsertRowid), email, fullName, role: "owner" });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

router.post("/api/auth/login", rateLimit(10, 10 * 60_000), (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "email and password required" });
  const { email, password } = parsed.data;

  const user = db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  const token = genToken();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(token, user.id, sessionExpiry());

  res.cookie("ee_session", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 864e5 });
  const role = db.prepare("SELECT name FROM roles WHERE id = ?").get(user.role_id);
  res.json({ id: user.id, email: user.email, fullName: user.full_name, role: role.name });
});

router.post("/api/auth/logout", (req, res) => {
  const token = req.cookies?.ee_session;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.clearCookie("ee_session");
  res.json({ ok: true });
});

router.get("/api/auth/me", auth(), (req, res) => res.json(req.user));

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

router.patch("/api/auth/password", auth(), (req, res) => {
  const parsed = passwordChangeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!bcrypt.compareSync(parsed.data.currentPassword, user.password_hash)) {
    return res.status(401).json({ error: "current password is incorrect" });
  }

  const newHash = bcrypt.hashSync(parsed.data.newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, req.user.id);
  res.json({ ok: true });
});
