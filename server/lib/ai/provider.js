import { AGENTS } from "./agents.js";
import { TOOL_DEFINITIONS, runTool } from "./tools.js";

const AI_PROVIDER = process.env.AI_PROVIDER || "mock";

/* ---------- mock provider — real logic, zero external dependency ----------
 * Deterministic intent-matching against the same tool contract a real LLM
 * uses, so the conversation is genuinely useful today and the swap to
 * AI_PROVIDER=anthropic later changes nothing about what the agent can do,
 * only how well it understands free-form phrasing. */
const mockReply = async (agentType, history, ctx) => {
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

/* ---------- anthropic provider — real Claude, tool-use loop ---------- */
const anthropicReply = async (agentType, history, ctx) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const system = AGENTS[agentType].systemPrompt;
  let messages = history.map(m => ({ role: m.role, content: m.content }));
  const toolResults = [];

  for (let round = 0; round < 2; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 500, system, messages, tools: TOOL_DEFINITIONS }),
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

export const getReply = (agentType, history, ctx) =>
  AI_PROVIDER === "anthropic" ? anthropicReply(agentType, history, ctx) : mockReply(agentType, history, ctx);
