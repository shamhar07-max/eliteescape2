import { AGENTS } from "./agents.js";
import { TOOL_DEFINITIONS, AGENT_TOOL_NAMES, runTool } from "./tools.js";

const AI_PROVIDER = process.env.AI_PROVIDER || "mock";
const STAFF_AGENT_TYPES = ["visa_assistant", "sales_assistant", "operations_assistant", "finance_assistant", "marketing_assistant", "executive_assistant"];

/* ---------- mock provider — real logic, zero external dependency ----------
 * Deterministic intent-matching against the same tool contract a real LLM
 * uses, so the conversation is genuinely useful today and the swap to
 * AI_PROVIDER=anthropic later changes nothing about what the agent can do,
 * only how well it understands free-form phrasing. */
const mockCustomerReply = async (agentType, history, ctx) => {
  const lastUser = [...history].reverse().find(m => m.role === "user")?.content || "";
  const s = lastUser.toLowerCase();
  const toolResults = [];

  if (/\b(human|agent|complaint|refund|refused|refusal)\b/.test(s)) {
    const r = await runTool("request_human_handoff", { reason: lastUser.slice(0, 200) }, ctx);
    toolResults.push({ name: "request_human_handoff", result: r });
    return { text: "I've flagged this for one of our specialists — they'll message you shortly on WhatsApp or email.", toolResults };
  }

  if (/\b(status|my booking|my lead|what's happening|update on)\b/.test(s)) {
    const r = await runTool("get_customer_summary", {}, ctx);
    toolResults.push({ name: "get_customer_summary", result: r });
    if (r.error) return { text: "I don't have a file for you yet — tell me your name and what you're planning and I'll get one started.", toolResults };
    const leadLines = r.leads.map(l => `${l.interest_type} (${l.status})`).join(", ") || "no open enquiries";
    const bookingLines = r.bookings.map(b => `${b.description} (${b.status})`).join(", ") || "no bookings yet";
    return { text: `Here's what I have on file — enquiries: ${leadLines}. Bookings: ${bookingLines}.`, toolResults };
  }

  const interestMap = [
    [/visa/, "visa"], [/safari|desert|dhow|burj|attraction|museum|ferrari|miracle/, "attraction"],
    [/flight/, "flight"], [/hotel/, "hotel"], [/insurance/, "insurance"],
    [/holiday|trip|package|tour|honeymoon|japan|bali|georgia|paris|maldives/, "holiday"],
  ];
  const match = interestMap.find(([re]) => re.test(s));

  if (match && ctx.customerId) {
    const r = await runTool("create_lead", { interestType: match[1], interestDetail: lastUser.slice(0, 200) }, ctx);
    toolResults.push({ name: "create_lead", result: r });
    return {
      text: agentType === "receptionist"
        ? `Got it — that's exactly what our Travel Consultant handles. I've started your file; a specialist will follow up with a fixed quote.`
        : `Lovely — I've noted that down and a specialist will follow up on WhatsApp with a fixed quote. Anything else you'd like to add (dates, travellers, budget)?`,
      toolResults,
    };
  }

  if (match && !ctx.customerId) {
    return { text: "I'd love to help with that — what name and WhatsApp number should I put on your file?", toolResults };
  }

  if (/^(hi|hello|hey|salam|good (morning|afternoon|evening))/.test(s)) {
    return {
      text: agentType === "receptionist"
        ? "Hello and welcome to Elite Escape! Are you looking at a holiday, a visa, or one of our UAE attractions?"
        : "Hi! Tell me the trip you're dreaming of and I'll get you moving on it.",
      toolResults,
    };
  }

  return { text: "Tell me a bit more — a destination, a visa country, or an attraction — and I'll take it from there.", toolResults };
};

/* Staff assistants don't hold a conversation about the customer — they
 * answer with real internal data every time, since (in mock mode) there's
 * no free-form language understanding to route on beyond "which agent is
 * this". Each agent just runs its own tool(s) and formats the result. */
const mockStaffReply = async (agentType, ctx) => {
  const toolResults = [];
  const run = async (name, input = {}) => {
    const r = await runTool(name, input, ctx);
    toolResults.push({ name, result: r });
    return r;
  };

  if (agentType === "visa_assistant") {
    const r = await run("summarize_visa_cases");
    if (!r.openCases) return { text: "No open visa cases right now.", toolResults };
    const lines = r.cases.map(c => `${c.case_number} (${c.destination_country}, ${c.status.replace(/_/g, " ")})${c.missing_documents ? ` — ${c.missing_documents} document(s) outstanding` : ""}`);
    return { text: `${r.openCases} open visa case(s):\n${lines.join("\n")}`, toolResults };
  }

  if (agentType === "sales_assistant") {
    const r = await run("summarize_leads_pipeline");
    const statusLine = r.byStatus.map(s => `${s.status}: ${s.n}`).join(", ");
    const staleLine = r.staleCount
      ? `${r.staleCount} lead(s) have gone quiet 3+ days: ${r.stale.map(l => `#${l.id} (${l.interest_type})`).join(", ")}`
      : "Nothing has gone quiet — pipeline is current.";
    return { text: `Pipeline — ${statusLine}. ${staleLine}`, toolResults };
  }

  if (agentType === "operations_assistant") {
    const r = await run("summarize_bookings_operations");
    const departuresLine = r.upcomingDepartures.length
      ? `${r.upcomingDepartures.length} departing in the next 14 days: ${r.upcomingDepartures.map(b => `#${b.id} (${b.travel_date_start})`).join(", ")}`
      : "Nothing departing in the next 14 days.";
    const stalledLine = r.stalledDrafts.length ? ` ${r.stalledDrafts.length} draft booking(s) stalled 7+ days — worth a check.` : "";
    return { text: `${departuresLine}${stalledLine}`, toolResults };
  }

  if (agentType === "finance_assistant") {
    const r = await run("summarize_finance");
    const overdueLine = r.overdueCount
      ? `${r.overdueCount} overdue invoice(s): ${r.overdueInvoices.map(i => `${i.invoice_number} (AED ${i.totalAed})`).join(", ")}`
      : "No overdue invoices.";
    return { text: `${overdueLine} ${r.draftInvoiceCount} invoice(s) still in draft.`, toolResults };
  }

  if (agentType === "marketing_assistant") {
    const r = await run("summarize_marketing_campaigns");
    const campaignLine = r.campaigns.length
      ? r.campaigns.map(c => `${c.name} (${c.status}, sent to ${c.sent_count})`).join("; ")
      : "No campaigns yet.";
    const seoLine = r.latestSeoAudit ? ` Latest SEO audit found ${r.latestSeoAudit.issues_found} issue(s) on ${r.latestSeoAudit.base_url}.` : "";
    return { text: `${campaignLine}.${seoLine}`, toolResults };
  }

  if (agentType === "executive_assistant") {
    const r = await run("owner_daily_brief");
    return {
      text: `Today: ${r.newLeadsToday} new lead(s), ${r.bookingsToday} booking(s). Revenue this month: AED ${r.revenueThisMonthAed}. `
        + `Pending: ${r.pendingLeaveRequests} leave request(s), ${r.pendingPurchaseOrders} purchase order(s) awaiting approval.`,
      toolResults,
    };
  }

  return { text: "Unrecognized staff assistant type.", toolResults };
};

/* ---------- anthropic provider — real Claude, tool-use loop ---------- */
const anthropicReply = async (agentType, history, ctx) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const system = AGENTS[agentType].systemPrompt;
  const allowedToolNames = AGENT_TOOL_NAMES[agentType] || [];
  const tools = TOOL_DEFINITIONS.filter(t => allowedToolNames.includes(t.name));
  let messages = history.map(m => ({ role: m.role, content: m.content }));
  const toolResults = [];

  for (let round = 0; round < 2; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 500, system, messages, tools }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
    const data = await res.json();

    const toolUse = data.content.filter(b => b.type === "tool_use");
    const text = data.content.filter(b => b.type === "text").map(b => b.text).join("\n");

    if (!toolUse.length || data.stop_reason !== "tool_use") return { text, toolResults };

    messages.push({ role: "assistant", content: data.content });
    const toolResultBlocks = [];
    for (const call of toolUse) {
      const result = await runTool(call.name, call.input, ctx);
      toolResults.push({ name: call.name, result });
      toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResultBlocks });
  }
  return { text: "Let me have a specialist follow up on that.", toolResults };
};

export const getReply = (agentType, history, ctx) => {
  if (AI_PROVIDER === "anthropic") return anthropicReply(agentType, history, ctx);
  return STAFF_AGENT_TYPES.includes(agentType) ? mockStaffReply(agentType, ctx) : mockCustomerReply(agentType, history, ctx);
};

export const isStaffAgent = (agentType) => STAFF_AGENT_TYPES.includes(agentType);
