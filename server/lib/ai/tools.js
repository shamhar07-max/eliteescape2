import { db } from "../../db.js";
import { notifyRole } from "../notify.js";
import { toFils, toAed } from "../money.js";

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

  // ===== Staff-facing tools — all read-only. AI never posts ledger entries,
  // changes a status, or messages a customer on its own; every one of these
  // just summarizes real data for a human to act on. =====
  {
    name: "summarize_visa_cases",
    description: "List visa cases that need attention: awaiting documents, in review, or otherwise not yet submitted/completed.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "summarize_leads_pipeline",
    description: "Summarize the sales pipeline: counts by status, and leads that have gone quiet (no update in 3+ days) and need follow-up.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "summarize_bookings_operations",
    description: "Summarize travel operations: bookings departing in the next 14 days, and draft bookings stalled for 7+ days.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "summarize_finance",
    description: "Summarize finance: overdue invoices (sent, past due date, not paid), and how many invoices are still in draft.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "summarize_marketing_campaigns",
    description: "Summarize marketing campaign performance: send counts per campaign, and current SEO issue count from the latest audit.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "owner_daily_brief",
    description: "A same-day executive summary: new leads today, bookings today, revenue this month, and pending approvals (leave requests, purchase orders).",
    input_schema: { type: "object", properties: {} },
  },
];

// Which tools each agent is allowed to call — a Finance Assistant has no
// business seeing create_lead, and a public-facing Receptionist has no
// business seeing internal ops/finance summaries. Enforced when building
// the tool list sent to a real LLM (mock mode enforces it implicitly,
// since each mock handler only calls its own agent's tools).
export const AGENT_TOOL_NAMES = {
  receptionist: ["create_lead", "get_customer_summary", "request_human_handoff"],
  travel_consultant: ["create_lead", "get_customer_summary", "request_human_handoff"],
  visa_assistant: ["summarize_visa_cases"],
  sales_assistant: ["summarize_leads_pipeline"],
  operations_assistant: ["summarize_bookings_operations"],
  finance_assistant: ["summarize_finance"],
  marketing_assistant: ["summarize_marketing_campaigns"],
  executive_assistant: ["owner_daily_brief", "summarize_leads_pipeline", "summarize_finance", "summarize_bookings_operations"],
};

/* Executes a tool call against the real database. `ctx` carries the
 * conversation's customerId (created lazily on first real contact-info). */
export const runTool = async (name, input, ctx) => {
  switch (name) {
    case "create_lead": {
      if (!ctx.customerId) return { error: "no customer identified yet — ask for their name and WhatsApp/email first" };
      const result = db.prepare(
        "INSERT INTO leads (customer_id, interest_type, interest_detail, budget_aed_fils, travel_date) VALUES (?, ?, ?, ?, ?)"
      ).run(ctx.customerId, input.interestType, input.interestDetail || null, input.budgetAed ? toFils(input.budgetAed) : null, input.travelDate || null);
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

    case "summarize_visa_cases": {
      const cases = db.prepare(`
        SELECT vc.id, vc.case_number, vc.destination_country, vc.visa_type, vc.status,
          (SELECT COUNT(*) FROM visa_documents d WHERE d.visa_case_id = vc.id AND d.status = 'requested') AS missing_documents
        FROM visa_cases vc
        WHERE vc.status NOT IN ('completed', 'rejected', 'withdrawn', 'cancelled')
        ORDER BY vc.updated_at ASC LIMIT 20
      `).all();
      return { openCases: cases.length, cases };
    }

    case "summarize_leads_pipeline": {
      const byStatus = db.prepare("SELECT status, COUNT(*) AS n FROM leads GROUP BY status").all();
      const stale = db.prepare(`
        SELECT id, interest_type, interest_detail, status, updated_at FROM leads
        WHERE status IN ('new', 'contacted') AND updated_at < datetime('now', '-3 days')
        ORDER BY updated_at ASC LIMIT 20
      `).all();
      return { byStatus, staleCount: stale.length, stale };
    }

    case "summarize_bookings_operations": {
      const upcomingDepartures = db.prepare(`
        SELECT id, booking_type, description, travel_date_start, status FROM bookings
        WHERE status = 'confirmed' AND travel_date_start BETWEEN date('now') AND date('now', '+14 days')
        ORDER BY travel_date_start ASC
      `).all();
      const stalledDrafts = db.prepare(`
        SELECT id, booking_type, description, created_at FROM bookings
        WHERE status = 'draft' AND created_at < datetime('now', '-7 days')
        ORDER BY created_at ASC LIMIT 20
      `).all();
      return { upcomingDepartures, stalledDrafts };
    }

    case "summarize_finance": {
      const overdueRows = db.prepare(`
        SELECT id, invoice_number, customer_id, due_date, total_aed_fils FROM invoices
        WHERE status = 'sent' AND due_date IS NOT NULL AND due_date < date('now')
        ORDER BY due_date ASC LIMIT 20
      `).all();
      const overdueInvoices = overdueRows.map(r => ({ ...r, totalAed: toAed(r.total_aed_fils) }));
      const draftCount = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'").get().n;
      return { overdueCount: overdueInvoices.length, overdueInvoices, draftInvoiceCount: draftCount };
    }

    case "summarize_marketing_campaigns": {
      const campaigns = db.prepare("SELECT id, name, channel, status, sent_count FROM campaigns ORDER BY created_at DESC LIMIT 10").all();
      const latestAudit = db.prepare("SELECT base_url, issues_found, run_at FROM seo_audits ORDER BY run_at DESC LIMIT 1").get() || null;
      return { campaigns, latestSeoAudit: latestAudit };
    }

    case "owner_daily_brief": {
      const newLeadsToday = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE date(created_at) = date('now')").get().n;
      const bookingsToday = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE date(created_at) = date('now')").get().n;
      const revenueFils = db.prepare(`
        SELECT COALESCE(SUM(total_aed_fils), 0) AS total FROM invoices
        WHERE status = 'paid' AND strftime('%Y-%m', issue_date) = strftime('%Y-%m', 'now')
      `).get().total;
      const pendingLeave = db.prepare("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'").get().n;
      const pendingPOs = db.prepare("SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'draft'").get().n;
      return { newLeadsToday, bookingsToday, revenueThisMonthAed: toAed(revenueFils), pendingLeaveRequests: pendingLeave, pendingPurchaseOrders: pendingPOs };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
};
