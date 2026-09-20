import { db } from "../db.js";

/* Notification delivery — provider abstraction so a real email/SMS channel
 * can be dropped in later (Phase 2's "Communications" module in the roadmap)
 * without touching any call site. Every notification is ALWAYS written to
 * the notifications table (so the in-app bell/feed always works); the
 * external channel is a best-effort bonus on top. */
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "console";

const sendEmail = async ({ to, subject, body }) => {
  if (EMAIL_PROVIDER === "console") {
    console.log(`[email:console] To: ${to}\nSubject: ${subject}\n${body}\n`);
    return { ok: true, provider: "console" };
  }
  // Future: EMAIL_PROVIDER === "smtp" | "sendgrid" | "ses" — same call shape.
  throw new Error(`Unknown EMAIL_PROVIDER: ${EMAIL_PROVIDER}`);
};

/* Notify a single user by id: always writes an in-app notification row,
 * and best-effort emails them if they have an email on file. */
export const notifyUser = async (userId, { type, title, body, entityType, entityId }) => {
  db.prepare(
    "INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, type, title, body || null, entityType || null, entityId || null);

  const user = db.prepare("SELECT email, full_name FROM users WHERE id = ?").get(userId);
  if (user?.email) {
    await sendEmail({ to: user.email, subject: title, body: body || title }).catch(err =>
      console.error(`[notify] email delivery failed for user ${userId}:`, err.message)
    );
  }
};

/* Notify every user holding a given role (e.g. all owners+admins on a new lead). */
export const notifyRole = async (roleNames, payload) => {
  const placeholders = roleNames.map(() => "?").join(",");
  const users = db.prepare(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name IN (${placeholders}) AND u.is_active = 1`
  ).all(...roleNames);
  await Promise.all(users.map(u => notifyUser(u.id, payload)));
  return users.length;
};
