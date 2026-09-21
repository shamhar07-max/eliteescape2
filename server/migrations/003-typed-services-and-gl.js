/* Adds typed-service columns to the pre-existing booking_items table (a
 * CREATE TABLE IF NOT EXISTS in schema.js is a no-op there, same limitation
 * documented in 001-money-to-fils.js) and seeds the standard chart of
 * accounts. Both idempotent — safe to run on every boot. */
const hasColumn = (db, table, column) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

const STANDARD_ACCOUNTS = [
  ["1000", "Cash", "asset", "debit"],
  ["1010", "Bank", "asset", "debit"],
  ["1100", "Accounts Receivable", "asset", "debit"],
  ["1300", "VAT Input Receivable", "asset", "debit"],
  ["2000", "Accounts Payable", "liability", "credit"],
  ["2100", "VAT Output Payable", "liability", "credit"],
  ["3000", "Owner's Equity", "equity", "credit"],
  ["3100", "Retained Earnings", "equity", "credit"],
  ["4000", "Travel Services Revenue", "revenue", "credit"],
  ["5000", "Supplier Cost of Services", "expense", "debit"],
  ["5100", "Salaries Expense", "expense", "debit"],
  ["5200", "Customer Refunds", "expense", "debit"],
  ["5300", "Office & Admin Expense", "expense", "debit"],
];

export function migrateTypedServicesAndGl(db) {
  if (!hasColumn(db, "booking_items", "service_type")) {
    db.exec("ALTER TABLE booking_items ADD COLUMN service_type TEXT NOT NULL DEFAULT 'other'");
  }
  if (!hasColumn(db, "booking_items", "supplier_id")) {
    db.exec("ALTER TABLE booking_items ADD COLUMN supplier_id INTEGER REFERENCES vendors(id)");
  }
  if (!hasColumn(db, "booking_items", "supplier_cost_aed_fils")) {
    db.exec("ALTER TABLE booking_items ADD COLUMN supplier_cost_aed_fils INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "booking_items", "service_status")) {
    db.exec("ALTER TABLE booking_items ADD COLUMN service_status TEXT NOT NULL DEFAULT 'requested'");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_booking_items_service_type ON booking_items(service_type)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_booking_items_supplier ON booking_items(supplier_id)");

  const insertAccount = db.prepare(
    "INSERT OR IGNORE INTO chart_of_accounts (code, name, type, normal_balance) VALUES (?, ?, ?, ?)"
  );
  for (const [code, name, type, normalBalance] of STANDARD_ACCOUNTS) insertAccount.run(code, name, type, normalBalance);
}
