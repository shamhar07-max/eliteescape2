/* Adds supplier-management columns to the pre-existing vendors table and a
 * document_id link on the pre-existing visa_documents table — both already
 * exist on live DBs, so their CREATE TABLE IF NOT EXISTS in schema.js is a
 * no-op there, same limitation documented in 001-money-to-fils.js. */
const hasColumn = (db, table, column) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

export function migrateSupplierAndDocuments(db) {
  const vendorColumns = [
    ["trn", "TEXT"],
    ["currency", "TEXT NOT NULL DEFAULT 'AED'"],
    ["payment_terms", "TEXT"],
    ["contract_start", "TEXT"],
    ["contract_end", "TEXT"],
    ["status", "TEXT NOT NULL DEFAULT 'active'"],
    ["address", "TEXT"],
    ["website", "TEXT"],
    ["notes", "TEXT"],
  ];
  for (const [column, ddl] of vendorColumns) {
    if (!hasColumn(db, "vendors", column)) db.exec(`ALTER TABLE vendors ADD COLUMN ${column} ${ddl}`);
  }

  if (!hasColumn(db, "visa_documents", "document_id")) {
    db.exec("ALTER TABLE visa_documents ADD COLUMN document_id INTEGER REFERENCES documents(id)");
  }
}
