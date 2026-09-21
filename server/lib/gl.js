import { db } from "../db.js";
import { nextSequence } from "./sequence.js";

/* Standard chart of accounts codes — seeded once in migrations/003, looked
 * up by code so posting logic never hardcodes an account's numeric id. */
export const ACCOUNTS = {
  CASH: "1000",
  BANK: "1010",
  ACCOUNTS_RECEIVABLE: "1100",
  VAT_INPUT: "1300",
  ACCOUNTS_PAYABLE: "2000",
  VAT_OUTPUT: "2100",
  OWNER_EQUITY: "3000",
  RETAINED_EARNINGS: "3100",
  REVENUE: "4000",
  SUPPLIER_COST: "5000",
  SALARY_EXPENSE: "5100",
  CUSTOMER_REFUNDS: "5200",
  OFFICE_EXPENSE: "5300",
};

const accountIdByCode = (code) => {
  const row = db.prepare("SELECT id FROM chart_of_accounts WHERE code = ?").get(code);
  if (!row) throw new Error(`unknown GL account code: ${code}`);
  return row.id;
};

/* Posts one balanced journal entry. Every AI Security review of this module
 * should find the same thing: nothing in server/lib/ai/ ever imports this
 * file — the AI workforce has no path to alter the ledger, per the master
 * spec's "AI never directly alters ledger entries" rule.
 *
 * Idempotent via (source_type, source_id): re-posting the same business
 * event (e.g. a route handler called twice) is a no-op, returning the
 * existing entry's id instead of a duplicate. */
export function postJournalEntry({ entryDate, memo, sourceType, sourceId, userId, lines }) {
  if (!lines || lines.length < 2) throw new Error("a journal entry needs at least two lines");
  const debitTotal = lines.reduce((sum, l) => sum + (l.debitFils || 0), 0);
  const creditTotal = lines.reduce((sum, l) => sum + (l.creditFils || 0), 0);
  if (debitTotal !== creditTotal) {
    throw new Error(`journal entry does not balance: debit ${debitTotal} fils != credit ${creditTotal} fils`);
  }
  if (debitTotal === 0) throw new Error("journal entry has zero amount");

  if (sourceType && sourceId != null) {
    const existing = db.prepare("SELECT id FROM journal_entries WHERE source_type = ? AND source_id = ?").get(sourceType, sourceId);
    if (existing) return existing.id;
  }

  const entryNumber = nextSequence("journal-entry", "JE");
  const result = db.prepare(
    "INSERT INTO journal_entries (entry_number, entry_date, memo, source_type, source_id, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(entryNumber, entryDate || new Date().toISOString().slice(0, 10), memo || null, sourceType || null, sourceId ?? null, userId || null);
  const journalEntryId = Number(result.lastInsertRowid);

  const insertLine = db.prepare(
    "INSERT INTO journal_lines (journal_entry_id, account_id, debit_aed_fils, credit_aed_fils, description) VALUES (?, ?, ?, ?, ?)"
  );
  for (const l of lines) {
    insertLine.run(journalEntryId, accountIdByCode(l.accountCode), l.debitFils || 0, l.creditFils || 0, l.description || null);
  }
  return journalEntryId;
}

/* Balance of one account as of an optional as-of date — debit-normal
 * accounts (asset/expense) report debit-credit, credit-normal accounts
 * (liability/equity/revenue) report credit-debit, so every balance is
 * signed the way a trial balance and P&L expect. */
export function accountBalanceFils(accountId, asOfDate) {
  const account = db.prepare("SELECT normal_balance FROM chart_of_accounts WHERE id = ?").get(accountId);
  const row = asOfDate
    ? db.prepare(`
        SELECT COALESCE(SUM(jl.debit_aed_fils), 0) AS debit, COALESCE(SUM(jl.credit_aed_fils), 0) AS credit
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE jl.account_id = ? AND je.status = 'posted' AND je.entry_date <= ?
      `).get(accountId, asOfDate)
    : db.prepare(`
        SELECT COALESCE(SUM(jl.debit_aed_fils), 0) AS debit, COALESCE(SUM(jl.credit_aed_fils), 0) AS credit
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE jl.account_id = ? AND je.status = 'posted'
      `).get(accountId);
  return account.normal_balance === "debit" ? row.debit - row.credit : row.credit - row.debit;
}
