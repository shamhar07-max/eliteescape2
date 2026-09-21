import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { toFils, toAed } from "../lib/money.js";

export const router = Router();

const serializeItem = (row) => ({
  ...row,
  unit_price_aed: toAed(row.unit_price_aed_fils),
  supplier_cost_aed: toAed(row.supplier_cost_aed_fils || 0),
});

const SERVICE_TYPES = ["holiday", "flight", "hotel", "visa", "transfer", "attraction", "insurance", "other"];

// Every column a service_type's typed detail form may fill in — sparse by
// design, only the ones matching that item's own service_type get sent.
const DETAIL_FIELDS = [
  "airline", "flightNumber", "pnr", "origin", "destination", "departureDate", "returnDate", "cabinClass",
  "hotelName", "checkIn", "checkOut", "roomType", "occupancy", "mealPlan",
  "pickupLocation", "dropoffLocation", "vehicleType", "pickupDatetime",
  "attractionName", "visitDate", "ticketType",
  "insuranceProvider", "policyNumber", "coverageStart", "coverageEnd",
  "visaCountry", "visaType",
];
const camelToSnake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

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
  const items = db.prepare(`
    SELECT bi.*, v.name AS supplier_name FROM booking_items bi
    LEFT JOIN vendors v ON v.id = bi.supplier_id WHERE bi.booking_id = ?
  `).all(req.params.id);
  const travelers = db.prepare("SELECT * FROM travelers WHERE booking_id = ? ORDER BY created_at ASC").all(req.params.id);
  const itemsWithDetails = items.map(item => {
    const details = db.prepare("SELECT * FROM booking_item_details WHERE booking_item_id = ?").get(item.id) || null;
    const travelerIds = db.prepare("SELECT traveler_id FROM booking_item_travelers WHERE booking_item_id = ?").all(item.id).map(r => r.traveler_id);
    return { ...serializeItem(item), details, travelerIds };
  });
  res.json({ ...booking, items: itemsWithDetails, travelers });
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

const detailSchema = z.object(Object.fromEntries(DETAIL_FIELDS.map(f => [f, z.string().optional()])));

const itemSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES).default("other"),
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitPriceAed: z.number().nonnegative(),
  supplierCostAed: z.number().nonnegative().default(0),
  supplierId: z.number().int().optional(),
  details: detailSchema.optional(),
  travelerIds: z.array(z.number().int()).optional(),
});

router.post("/api/bookings/:id/items", auth(["ops.write"]), (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const booking = db.prepare("SELECT id FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "booking not found" });

  const i = parsed.data;
  if (i.supplierId && !db.prepare("SELECT id FROM vendors WHERE id = ?").get(i.supplierId)) {
    return res.status(404).json({ error: "supplier not found" });
  }

  const result = db.prepare(
    "INSERT INTO booking_items (booking_id, description, quantity, unit_price_aed_fils, service_type, supplier_id, supplier_cost_aed_fils) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(req.params.id, i.description, i.quantity, toFils(i.unitPriceAed), i.serviceType, i.supplierId || null, toFils(i.supplierCostAed));
  const itemId = Number(result.lastInsertRowid);

  if (i.details && Object.keys(i.details).length) {
    const cols = Object.keys(i.details).map(camelToSnake);
    const vals = Object.values(i.details);
    db.prepare(`INSERT INTO booking_item_details (booking_item_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`)
      .run(itemId, ...vals);
  }

  if (i.travelerIds?.length) {
    const insertLink = db.prepare("INSERT OR IGNORE INTO booking_item_travelers (booking_item_id, traveler_id) VALUES (?, ?)");
    for (const travelerId of i.travelerIds) insertLink.run(itemId, travelerId);
  }

  res.status(201).json({ id: itemId, bookingId: Number(req.params.id), ...i });
});

router.patch("/api/booking-items/:id/service-status", auth(["ops.write"]), (req, res) => {
  const schema = z.object({ status: z.enum(["requested", "confirmed", "cancelled", "completed"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const item = db.prepare("SELECT id FROM booking_items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "item not found" });
  db.prepare("UPDATE booking_items SET service_status = ? WHERE id = ?").run(parsed.data.status, req.params.id);
  res.json({ id: Number(req.params.id), status: parsed.data.status });
});

router.delete("/api/booking-items/:id", auth(["ops.write"]), (req, res) => {
  const item = db.prepare("SELECT id FROM booking_items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "item not found" });
  db.prepare("DELETE FROM booking_items WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ===== Travelers =====
// No .default() on travelerType — this schema's .partial() is reused for
// PATCH below, and zod's .partial() does not clear .default(): an absent
// key would silently resolve to "adult" and overwrite an existing value.
// The POST handler applies the "adult" default explicitly instead.
const travelerSchema = z.object({
  fullName: z.string().min(1),
  travelerType: z.enum(["adult", "child", "infant"]).optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  nationality: z.string().optional(),
  passportNumber: z.string().optional(),
  passportExpiry: z.string().optional(),
  visaStatus: z.string().optional(),
  specialAssistance: z.string().optional(),
  dietaryNeeds: z.string().optional(),
  emergencyContact: z.string().optional(),
});

router.post("/api/bookings/:id/travelers", auth(["ops.write"]), (req, res) => {
  const parsed = travelerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const booking = db.prepare("SELECT id FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "booking not found" });

  const t = parsed.data;
  const travelerType = t.travelerType || "adult";
  const result = db.prepare(`
    INSERT INTO travelers (booking_id, full_name, traveler_type, date_of_birth, gender, nationality, passport_number, passport_expiry, visa_status, special_assistance, dietary_needs, emergency_contact)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, t.fullName, travelerType, t.dateOfBirth || null, t.gender || null, t.nationality || null,
    t.passportNumber || null, t.passportExpiry || null, t.visaStatus || null, t.specialAssistance || null, t.dietaryNeeds || null, t.emergencyContact || null);

  res.status(201).json({ id: Number(result.lastInsertRowid), bookingId: Number(req.params.id), ...t, travelerType });
});

router.patch("/api/travelers/:id", auth(["ops.write"]), (req, res) => {
  const parsed = travelerSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const traveler = db.prepare("SELECT * FROM travelers WHERE id = ?").get(req.params.id);
  if (!traveler) return res.status(404).json({ error: "traveler not found" });

  const t = parsed.data;
  const merged = {
    full_name: t.fullName ?? traveler.full_name,
    traveler_type: t.travelerType ?? traveler.traveler_type,
    date_of_birth: t.dateOfBirth ?? traveler.date_of_birth,
    gender: t.gender ?? traveler.gender,
    nationality: t.nationality ?? traveler.nationality,
    passport_number: t.passportNumber ?? traveler.passport_number,
    passport_expiry: t.passportExpiry ?? traveler.passport_expiry,
    visa_status: t.visaStatus ?? traveler.visa_status,
    special_assistance: t.specialAssistance ?? traveler.special_assistance,
    dietary_needs: t.dietaryNeeds ?? traveler.dietary_needs,
    emergency_contact: t.emergencyContact ?? traveler.emergency_contact,
  };
  db.prepare(`
    UPDATE travelers SET full_name = ?, traveler_type = ?, date_of_birth = ?, gender = ?, nationality = ?,
      passport_number = ?, passport_expiry = ?, visa_status = ?, special_assistance = ?, dietary_needs = ?, emergency_contact = ?,
      updated_at = datetime('now') WHERE id = ?
  `).run(...Object.values(merged), req.params.id);

  res.json({ id: Number(req.params.id), ...merged });
});

router.delete("/api/travelers/:id", auth(["ops.write"]), (req, res) => {
  const traveler = db.prepare("SELECT id FROM travelers WHERE id = ?").get(req.params.id);
  if (!traveler) return res.status(404).json({ error: "traveler not found" });
  db.prepare("DELETE FROM travelers WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
