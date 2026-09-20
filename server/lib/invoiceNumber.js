import { db } from "../db.js";

/* UAE FTA requires sequential invoice numbering with no gaps. Using an atomic
 * UPDATE...RETURNING against a dedicated counter (not MAX(id) on invoices,
 * which would create a gap if an invoice is ever deleted) — one counter per
 * calendar year, e.g. INV-2026-0001, INV-2026-0002, resetting to 0001 each year. */
export const nextInvoiceNumber = () => {
  const year = new Date().getFullYear();
  const counterName = `invoice-${year}`;

  db.prepare("INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)").run(counterName);
  const row = db.prepare("UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value").get(counterName);

  return `INV-${year}-${String(row.value).padStart(4, "0")}`;
};
