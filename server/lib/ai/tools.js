import { db } from "../../db.js";
import { notifyRole } from "../notify.js";

/* Tool definitions in Anthropic Messages API tool-use format — used as-is
 * when AI_PROVIDER=anthropic, and as the same contract the mock provider's
 * intent-matching targets, so switching providers never changes what an
 * agent can DO, only how well it decides when to do it. */
export const TOOL_DEFINITIONS = [
  {
    name: "create_lead",
    description: "Create a CRM lead for this customer when they show real interest in a specific holiday, visa, attraction, flight, hotel, or insurance product — not for idle chat.",
    input_schema: {
      type: "object",
      properties: {
        interestType: { type: "string", enum: ["holiday", "visa", "attraction", "flight", "hotel", "insurance", "general"] },
        interestDetail: { type: "string", description: "What they want, e.g. 'Japan 7-day in March' or 'USA visa'" },
        budgetAed: { type: "number", description: "Stated budget in AED, if mentioned" },
        travelDate: { type: "string", description: "Stated travel date, if mentioned" },
      },
      required: ["interestType", "interestDetail"],
    },
  },
  {
    name: "get_customer_summary",
    description: "Look up this customer's existing leads and bookings, e.g. to answer 'what's the status of my booking?'",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "request_human_handoff",
    description: "Escalate to a human specialist — use when the customer explicitly asks for a person, or the request is too complex/sensitive for an AI agent (complaints, refunds, visa refusals).",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

/* Executes a tool call against the real database. `ctx` carries the
 * conversation's customerId (created lazily on first real contact-info). */
export const runTool = async (name, input, ctx) => {
  switch (name) {
    case "create_lead": {
      if (!ctx.customerId) return { error: "no customer identified yet — ask for their name and WhatsApp/email first" };
      const result = db.prepare(
        "INSERT INTO leads (customer_id, interest_type, interest_detail, budget_aed, travel_date) VALUES (?, ?, ?, ?, ?)"
      ).run(ctx.customerId, input.interestType, input.interestDetail || null, input.budgetAed || null, input.travelDate || null);
      db.prepare("INSERT INTO lead_activities (lead_id, channel, body) VALUES (?, 'ai_agent', ?)")
        .run(result.lastInsertRowid, `Lead captured by AI ${ctx.agentType} agent: ${input.interestDetail}`);
      db.prepare("INSERT INTO audit_log (action, entity_type, entity_id, detail) VALUES ('create', 'lead', ?, ?)")
        .run(result.lastInsertRowid, `via AI agent (conversation #${ctx.conversationId})`);
      await notifyRole(["owner", "admin"], {
        type: "new_lead",
        title: `New ${input.interestType} lead via AI: ${ctx.customerName || "a customer"}`,
        body: input.interestDetail,
        entityType: "lead",
        entityId: Number(result.lastInsertRowid),
      });
      return { ok: true, leadId: Number(result.lastInsertRowid) };
    }

    case "get_customer_summary": {
      if (!ctx.customerId) return { error: "no customer identified yet" };
      const leads = db.prepare("SELECT interest_type, interest_detail, status, created_at FROM leads WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5").all(ctx.customerId);
      const bookings = db.prepare("SELECT booking_type, description, status, travel_date_start FROM bookings WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5").all(ctx.customerId);
      return { leads, bookings };
    }

    case "request_human_handoff": {
      db.prepare("UPDATE conversations SET status = 'handed_off', updated_at = datetime('now') WHERE id = ?").run(ctx.conversationId);
      await notifyRole(["owner", "admin"], {
        type: "system",
        title: `AI handoff requested: ${ctx.customerName || "a customer"}`,
        body: input.reason,
        entityType: "conversation",
        entityId: ctx.conversationId,
      });
      return { ok: true };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
};
