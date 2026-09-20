import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { sendMarketingMessage } from "../lib/marketingSend.js";

export const router = Router();

const campaignSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["email", "whatsapp"]),
  subject: z.string().optional(),
  message: z.string().min(1),
  audienceSource: z.enum(["customers", "leads"]).default("customers"),
  filterInterestType: z.string().optional(),
  filterLeadStatus: z.string().optional(),
  filterSource: z.string().optional(),
});

// Resolves the live audience for a campaign from the CRM spine — no stored
// recipient list, so editing a draft's filters always previews fresh data.
const resolveAudience = (campaign) => {
  if (campaign.audience_source === "leads") {
    let sql = "SELECT DISTINCT c.id, c.full_name, c.email, c.whatsapp FROM leads l JOIN customers c ON c.id = l.customer_id WHERE 1=1";
    const params = [];
    if (campaign.filter_interest_type) { sql += " AND l.interest_type = ?"; params.push(campaign.filter_interest_type); }
    if (campaign.filter_lead_status) { sql += " AND l.status = ?"; params.push(campaign.filter_lead_status); }
    return db.prepare(sql).all(...params);
  }
  let sql = "SELECT id, full_name, email, whatsapp FROM customers WHERE 1=1";
  const params = [];
  if (campaign.filter_source) { sql += " AND source = ?"; params.push(campaign.filter_source); }
  return db.prepare(sql).all(...params);
};

const reachableAudience = (campaign) => {
  const audience = resolveAudience(campaign);
  return campaign.channel === "email" ? audience.filter(p => p.email) : audience.filter(p => p.whatsapp);
};

router.get("/api/campaigns", auth(["marketing.read"]), (req, res) => {
  res.json(db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100").all());
});

router.post("/api/campaigns", auth(["marketing.write"]), (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const c = parsed.data;

  const result = db.prepare(`
    INSERT INTO campaigns (name, channel, subject, message, audience_source, filter_interest_type, filter_lead_status, filter_source, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(c.name, c.channel, c.subject || null, c.message, c.audienceSource, c.filterInterestType || null, c.filterLeadStatus || null, c.filterSource || null, req.user.id);

  res.status(201).json({ id: Number(result.lastInsertRowid), ...c, status: "draft" });
});

router.get("/api/campaigns/:id", auth(["marketing.read"]), (req, res) => {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campaign not found" });
  const sends = db.prepare("SELECT * FROM campaign_sends WHERE campaign_id = ? ORDER BY sent_at DESC LIMIT 200").all(req.params.id);
  res.json({ ...campaign, sends });
});

router.get("/api/campaigns/:id/audience-preview", auth(["marketing.read"]), (req, res) => {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campaign not found" });
  const audience = reachableAudience(campaign);
  res.json({ count: audience.length, sample: audience.slice(0, 10) });
});

router.post("/api/campaigns/:id/send", auth(["marketing.write"]), async (req, res) => {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campaign not found" });
  if (campaign.status === "sent") return res.status(409).json({ error: "campaign already sent" });

  const audience = reachableAudience(campaign);
  if (!audience.length) return res.status(400).json({ error: "no recipients match this campaign's audience" });

  const insertSend = db.prepare("INSERT INTO campaign_sends (campaign_id, customer_id, recipient) VALUES (?, ?, ?)");
  for (const person of audience) {
    const recipient = campaign.channel === "email" ? person.email : person.whatsapp;
    await sendMarketingMessage({ channel: campaign.channel, to: recipient, subject: campaign.subject, body: campaign.message });
    insertSend.run(campaign.id, person.id, recipient);
  }

  db.prepare("UPDATE campaigns SET status = 'sent', sent_at = datetime('now'), sent_count = ? WHERE id = ?").run(audience.length, campaign.id);
  db.prepare("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, 'send', 'campaign', ?, ?)")
    .run(req.user.id, campaign.id, `${audience.length} recipients`);

  res.json({ id: Number(req.params.id), status: "sent", sentCount: audience.length });
});
