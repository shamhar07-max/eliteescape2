import { db } from "../db.js";

/* Reads the lb_session-style cookie, loads the user + role + permission set.
 * `auth()` with no args just requires login; `auth(['crm.write'])` requires
 * the caller's role to hold every listed permission code. */
export const auth = (requiredPerms = []) => (req, res, next) => {
  const token = req.cookies?.ee_session;
  if (!token) return res.status(401).json({ error: "not authenticated" });

  const session = db.prepare(
    "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')"
  ).get(token);
  if (!session) return res.status(401).json({ error: "session expired" });

  const user = db.prepare(
    "SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.is_active = 1"
  ).get(session.user_id);
  if (!user) return res.status(401).json({ error: "user not found or inactive" });

  const perms = db.prepare(`
    SELECT p.code FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ?
  `).all(user.role_id).map(r => r.code);

  if (requiredPerms.length && user.role_name !== "owner") {
    const missing = requiredPerms.filter(p => !perms.includes(p));
    if (missing.length) return res.status(403).json({ error: "missing permissions", missing });
  }

  req.user = { id: user.id, email: user.email, fullName: user.full_name, role: user.role_name, permissions: perms };
  next();
};
