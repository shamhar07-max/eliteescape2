import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";

export const router = Router();

const bookingSchema = z.object({
  customerId: z.number().int(),
  leadId: z.number().int().optional(),
  bookingType: z.enum(["holiday", "visa", "attraction", "flight", "hotel", "insurance"]),
  description: z.string().min(1),
  travelDateStart: z.string().optional(),
  travelDateEnd: z.string().optional(),
});

router.get("/api/bookings", auth(["ops.read"]), (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare("SELECT * FROM bookings WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
    : db.prepare("SELECT * FROM bookings ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows);
});

router.get("/api/bookings/:id", auth(["ops.read"]), (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "booking not found" });
  const items = db.prepare("SELECT * FROM booking_items WHERE booking_id = ?").all(req.params.id);
  res.json({ ...booking, items });
});

router.post("/api/bookings", auth(["ops.write"]), (req, res) => {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const b = parsed.data;

  if (b.leadId) {
    const lead = db.prepare("SELECT id, status FROM leads WHERE id = ?").get(b.leadId);
    if (!lead) return res.status(404).json({ error: "lead not found" });
  }

  const result = db.prepare(
    "INSERT INTO bookings (customer_id, lead_id, booking_type, description, travel_date_start, travel_date_end, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(b.customerId, b.leadId || null, b.bookingType, b.description, b.travelDateStart || null, b.travelDateEnd || null, req.user.id);

  if (b.leadId) {
    db.prepare("UPDATE leads SET status = 'won', updated_at = datetime('now') WHERE id = ?").run(b.leadId);
    db.prepare("INSERT INTO lead_activities (lead_id, actor_user_id, channel, body) VALUES (?, ?, 'note', ?)")
      .run(b.leadId, req.user.id, `Converted to booking #${result.lastInsertRowid}`);
  }

  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id) VALUES (?, 'create', 'booking', ?)")
    .run(req.user.id, result.lastInsertRowid);

  res.status(201).json({ id: Number(result.lastInsertRowid), ...b, status: "draft" });
});

const statusSchema = z.object({ status: z.enum(["draft", "confirmed", "completed", "cancelled"]) });

router.patch("/api/bookings/:id/status", auth(["ops.write"]), (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const booking = db.prepare("SELECT id FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "booking not found" });

  db.prepare("UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(parsed.data.status, req.params.id);
  res.json({ id: Number(req.params.id), status: parsed.data.status });
});

const itemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitPriceAed: z.number().nonnegative(),
});

router.post("/api/bookings/:id/items", auth(["ops.write"]), (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const booking = db.prepare("SELECT id FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "booking not found" });

  const i = parsed.data;
  const result = db.prepare(
    "INSERT INTO booking_items (booking_id, description, quantity, unit_price_aed) VALUES (?, ?, ?, ?)"
  ).run(req.params.id, i.description, i.quantity, i.unitPriceAed);

  res.status(201).json({ id: Number(result.lastInsertRowid), bookingId: Number(req.params.id), ...i });
});

router.delete("/api/booking-items/:id", auth(["ops.write"]), (req, res) => {
  const item = db.prepare("SELECT id FROM booking_items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "item not found" });
  db.prepare("DELETE FROM booking_items WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
