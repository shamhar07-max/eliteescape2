import { db } from "../db.js";

/* Atomic UPDATE...RETURNING against a dedicated counter (not MAX(id) on the
 * owning table, which would create a gap if a row is ever deleted) — one
 * counter per calendar year per document type, resetting to 0001 each year.
 * UAE FTA requires this for tax invoices; applied to POs too for the same
 * clean-audit-trail reason. */
export const nextSequence = (counterKey, numberPrefix) => {
  const year = new Date().getFullYear();
  const counterName = `${counterKey}-${year}`;

  db.prepare("INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)").run(counterName);
  const row = db.prepare("UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value").get(counterName);

  return `${numberPrefix}-${year}-${String(row.value).padStart(4, "0")}`;
};
