import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { getReply, isStaffAgent } from "../lib/ai/provider.js";
import { AGENTS } from "../lib/ai/agents.js";

const STAFF_AGENT_TYPES = ["visa_assistant", "sales_assistant", "operations_assistant", "finance_assistant", "marketing_assistant", "executive_assistant"];

export const router = Router();

const ALLOWED_ORIGINS = (process.env.PUBLIC_WEBSITE_ORIGINS || "http://localhost:8095,http://localhost:8090,http://localhost:8097,https://eliteescapetourism.com")
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

const chatSchema = z.object({
  conversationId: z.number().int().optional(),
  agentType: z.enum(["receptionist", "travel_consultant"]).default("receptionist"),
  message: z.string().min(1).max(2000),
  contact: z.object({
    fullName: z.string().min(1).max(200),
    whatsapp: z.string().max(40).optional(),
    email: z.string().email().max(200).optional(),
  }).optional(),
});

router.options("/api/public/ai/chat", publicCors);

router.post("/api/public/ai/chat", publicCors, rateLimit(60, 10 * 60_000), async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  let conversation;
  if (d.conversationId) {
    conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(d.conversationId);
    if (!conversation) return res.status(404).json({ error: "conversation not found" });
  } else {
    let customerId = null;
    if (d.contact) {
      const contact = d.contact.whatsapp || d.contact.email;
      let customer = contact
        ? db.prepare("SELECT id FROM customers WHERE whatsapp = ? OR email = ?").get(d.contact.whatsapp || null, d.contact.email || null)
        : null;
      if (!customer) {
        const result = db.prepare("INSERT INTO customers (full_name, email, whatsapp, source) VALUES (?, ?, ?, 'website')")
          .run(d.contact.fullName, d.contact.email || null, d.contact.whatsapp || null);
        customer = { id: Number(result.lastInsertRowid) };
      }
      customerId = customer.id;
    }
    const result = db.prepare("INSERT INTO conversations (customer_id, agent_type, channel) VALUES (?, ?, 'website_chat')")
      .run(customerId, d.agentType);
    conversation = { id: Number(result.lastInsertRowid), customer_id: customerId, agent_type: d.agentType, status: "open" };
  }

  if (conversation.status === "handed_off") {
    return res.json({ conversationId: conversation.id, reply: "A specialist is already on this — they'll be with you shortly on WhatsApp.", handedOff: true });
  }

  db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)").run(conversation.id, d.message);

  const historyRows = db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 40").all(conversation.id);
  const customer = conversation.customer_id ? db.prepare("SELECT full_name FROM customers WHERE id = ?").get(conversation.customer_id) : null;

  const ctx = { conversationId: conversation.id, customerId: conversation.customer_id, customerName: customer?.full_name, agentType: conversation.agent_type };
  let reply;
  try {
    reply = await getReply(conversation.agent_type, historyRows, ctx);
  } catch (err) {
    console.error("[ai] provider error:", err.message);
    return res.status(503).json({ error: "AI agent temporarily unavailable — please try WhatsApp instead" });
  }

  db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)").run(conversation.id, reply.text);
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation.id);

  res.json({ conversationId: conversation.id, agentType: conversation.agent_type, reply: reply.text });
});

// ===== Staff oversight (authenticated) =====
router.get("/api/conversations", auth(["crm.read"]), (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, cu.full_name AS customer_name
    FROM conversations c LEFT JOIN customers cu ON cu.id = c.customer_id
    ORDER BY c.updated_at DESC LIMIT 100
  `).all();
  res.json(rows);
});

router.get("/api/conversations/:id/messages", auth(["crm.read"]), (req, res) => {
  const convo = db.prepare("SELECT id FROM conversations WHERE id = ?").get(req.params.id);
  if (!convo) return res.status(404).json({ error: "conversation not found" });
  const rows = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(req.params.id);
  res.json(rows);
});

router.get("/api/ai/agents", auth(), (req, res) => {
  res.json(Object.entries(AGENTS).map(([key, a]) => ({ key, label: a.label })));
});

// ===== Staff AI assistants (authenticated, internal-data only) =====
const staffChatSchema = z.object({
  conversationId: z.number().int().optional(),
  agentType: z.enum(STAFF_AGENT_TYPES),
  message: z.string().min(1).max(2000).optional(),
});

router.post("/api/ai/staff-chat", auth(), async (req, res) => {
  const parsed = staffChatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  if (!isStaffAgent(d.agentType)) return res.status(400).json({ error: "not a staff assistant type" });

  let conversation;
  if (d.conversationId) {
    conversation = db.prepare("SELECT * FROM conversations WHERE id = ? AND agent_type = ?").get(d.conversationId, d.agentType);
    if (!conversation) return res.status(404).json({ error: "conversation not found" });
  } else {
    const result = db.prepare("INSERT INTO conversations (customer_id, agent_type, channel) VALUES (NULL, ?, 'staff_console')").run(d.agentType);
    conversation = { id: Number(result.lastInsertRowid), customer_id: null, agent_type: d.agentType, status: "open" };
  }

  db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)").run(conversation.id, d.message || `[${req.user.fullName} requested a briefing]`);

  const ctx = { conversationId: conversation.id, customerId: null, agentType: conversation.agent_type, staffUserId: req.user.id };
  let reply;
  try {
    reply = await getReply(conversation.agent_type, [], ctx);
  } catch (err) {
    console.error("[ai] staff provider error:", err.message);
    return res.status(503).json({ error: "AI assistant temporarily unavailable" });
  }

  db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)").run(conversation.id, reply.text);
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation.id);

  res.json({ conversationId: conversation.id, agentType: conversation.agent_type, reply: reply.text });
});

router.get("/api/ai/staff-chat/:conversationId/messages", auth(), (req, res) => {
  const convo = db.prepare("SELECT id, agent_type FROM conversations WHERE id = ? AND channel = 'staff_console'").get(req.params.conversationId);
  if (!convo) return res.status(404).json({ error: "conversation not found" });
  const rows = db.prepare("SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(req.params.conversationId);
  res.json(rows);
});
