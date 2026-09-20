import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db.js";
import { genToken, sessionExpiry } from "../lib/crypto.js";
import { auth } from "../middleware/auth.js";

export const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: z.enum(["owner", "admin", "sales", "ops", "finance", "hr"]).default("sales"),
});

router.post("/api/auth/register", (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { email, password, fullName, role } = parsed.data;

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "email already registered" });

  const roleRow = db.prepare("SELECT id FROM roles WHERE name = ?").get(role);
  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    "INSERT INTO users (email, password_hash, full_name, role_id) VALUES (?, ?, ?, ?)"
  ).run(email, passwordHash, fullName, roleRow.id);

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id) VALUES (?, 'register', 'user', ?)")
    .run(result.lastInsertRowid, result.lastInsertRowid);

  res.status(201).json({ id: Number(result.lastInsertRowid), email, fullName, role });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

router.post("/api/auth/login", (req, res) => {
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
