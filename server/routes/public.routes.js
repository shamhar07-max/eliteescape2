import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { rateLimit } from "../lib/rateLimit.js";
import { notifyRole } from "../lib/notify.js";

export const router = Router();

/* The only door the public marketing website (a separate, unrelated codebase
 * with no backend of its own) has into this platform. No auth — it's called
 * directly from client-side JS on eliteescapetourism.com — so it can ONLY
 * create a customer + lead + one activity note. Nothing else is reachable
 * through this route, by design. */
const ALLOWED_ORIGINS = (process.env.PUBLIC_WEBSITE_ORIGINS || "http://localhost:8095,http://localhost:8090,https://eliteescapetourism.com")
  .split(",").map(s => s.trim());

const publicCors = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
};

const publicLeadSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().max(40).optional(),
  whatsapp: z.string().max(40).optional(),
  email: z.string().email().max(200).optional(),
  interestType: z.enum(["holiday", "visa", "attraction", "flight", "hotel", "insurance", "general"]).default("general"),
  interestDetail: z.string().max(500).optional(),
  sourceChannel: z.enum(["contact_form", "callback_modal", "deal_alerts", "chatbot", "elite_reach"]),
});

router.options("/api/public/leads", publicCors);

router.post("/api/public/leads", publicCors, rateLimit(20, 10 * 60_000), async (req, res) => {
  const parsed = publicLeadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  // Find an existing customer by whatsapp/phone/email before creating a new one,
  // so repeat visitors don't fragment into duplicate CRM records.
  const contact = d.whatsapp || d.phone || d.email;
  let customer = contact
    ? db.prepare("SELECT * FROM customers WHERE whatsapp = ? OR phone = ? OR email = ?")
        .get(d.whatsapp || null, d.phone || null, d.email || null)
    : null;

  if (!customer) {
    const source = d.sourceChannel === "elite_reach" ? "elite_reach" : "website";
    const result = db.prepare(
      "INSERT INTO customers (full_name, email, phone, whatsapp, source) VALUES (?, ?, ?, ?, ?)"
    ).run(d.fullName, d.email || null, d.phone || null, d.whatsapp || null, source);
    customer = { id: Number(result.lastInsertRowid) };
  }

  const leadResult = db.prepare(
    "INSERT INTO leads (customer_id, interest_type, interest_detail) VALUES (?, ?, ?)"
  ).run(customer.id, d.interestType, d.interestDetail || null);

  db.prepare("INSERT INTO lead_activities (lead_id, channel, body) VALUES (?, ?, ?)")
    .run(leadResult.lastInsertRowid, d.sourceChannel, d.interestDetail || `New ${d.sourceChannel.replace("_", " ")} submission`);

  db.prepare("INSERT INTO audit_log (action, entity_type, entity_id, detail) VALUES ('create', 'lead', ?, ?)")
    .run(leadResult.lastInsertRowid, `via public website (${d.sourceChannel})`);

  await notifyRole(["owner", "admin"], {
    type: "new_lead",
    title: `New ${d.interestType} lead: ${d.fullName}`,
    body: d.interestDetail || `Submitted via ${d.sourceChannel.replace("_", " ")} on the website.`,
    entityType: "lead",
    entityId: Number(leadResult.lastInsertRowid),
  });

  res.status(201).json({ ok: true, leadId: Number(leadResult.lastInsertRowid), customerId: customer.id });
});
