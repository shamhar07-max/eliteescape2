import { Router } from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";

export const router = Router();

router.get("/api/notifications", auth(), (req, res) => {
  const unreadOnly = req.query.unread === "1";
  const rows = unreadOnly
    ? db.prepare("SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC LIMIT 100").all(req.user.id)
    : db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(req.user.id);
  res.json(rows);
});

router.get("/api/notifications/unread-count", auth(), (req, res) => {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0").get(req.user.id);
  res.json({ count: n });
});

router.patch("/api/notifications/:id/read", auth(), (req, res) => {
  const notif = db.prepare("SELECT id FROM notifications WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!notif) return res.status(404).json({ error: "notification not found" });
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/api/notifications/read-all", auth(), (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0").run(req.user.id);
  res.json({ ok: true });
});
