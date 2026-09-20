/* Marketing send provider abstraction — same console/real-provider pattern as
 * lib/notify.js's EMAIL_PROVIDER, kept separate because marketing sends are
 * bulk/promotional (never mixed with transactional in-app notifications) and
 * cover both email and WhatsApp. */
const MARKETING_PROVIDER = process.env.MARKETING_PROVIDER || "console";

export const sendMarketingMessage = async ({ channel, to, subject, body }) => {
  if (MARKETING_PROVIDER === "console") {
    console.log(`[marketing:console:${channel}] To: ${to}${subject ? `\nSubject: ${subject}` : ""}\n${body}\n`);
    return { ok: true, provider: "console" };
  }
  // Future: MARKETING_PROVIDER === "sendgrid" | "whatsapp_business" — same call shape.
  throw new Error(`Unknown MARKETING_PROVIDER: ${MARKETING_PROVIDER}`);
};
