/* Adds bookings.quotation_id for an existing database created before
 * quotations existed (Phase 9). Unlike the money-to-fils migration, this
 * is a simple nullable column addition — SQLite supports ALTER TABLE ADD
 * COLUMN directly, no table rebuild needed. Idempotent: checks for the
 * column first, safe to run on every boot. */

const hasColumn = (db, table, column) =>
  db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, column) !== undefined;

export const addBookingQuotationLink = (db) => {
  if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bookings'`).get() &&
      !hasColumn(db, "bookings", "quotation_id")) {
    db.exec(`ALTER TABLE bookings ADD COLUMN quotation_id INTEGER REFERENCES quotations(id)`);
    console.log("[migration] bookings.quotation_id added");
  }
  // Safe whether the column just arrived above or was already present from
  // a fresh CREATE TABLE — schema.js's own index block can't reference this
  // column unconditionally without failing on a pre-existing bookings table.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_quotation ON bookings(quotation_id)`);
};
